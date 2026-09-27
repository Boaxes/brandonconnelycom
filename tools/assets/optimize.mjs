// usage: node optimize.mjs [name ...]   (no names: every public/models/*.glb)
//
// Post-processing for the baked scans, run after tools/blender/scans.py:
//  - textures become GPU-compressed KTX2, mipmaps included, which the browser transcodes to what the GPU
//    takes (ASTC on Apple GPUs, BC7 on most desktops): a quarter of the memory the JPEG/PNG textures take
//    once decoded. The animals seen from a hand's breadth away (CLOSE) are UASTC (near-lossless, ~3x the
//    download of a JPEG); everything else is ETC1S at its highest quality (about a JPEG's size; a slight
//    shift in colour, and in a normal map a degree or so, that the water hides at the distances they're
//    seen from). Normal maps are encoded as linear data. The book's rock (KEEP) keeps its JPEGs: it's
//    looked at from half a metre in the opening, and UASTC would have made it 13 MB to download.
// Textures already in KTX2 are left alone, so it can be run again after adding or re-baking a scan.
// Needs `basisu` (brew install basis_universal).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MODELS = path.resolve(import.meta.dirname, '../../public/models');
/** seen close up: the sea lion that stares, the curious copper rockfish */
const CLOSE = ['ca_sea_lion', 'rockfish_copper'];
/** left as they are */
const KEEP = ['hero_rock'];
const only = process.argv.slice(2);
const files = fs.readdirSync(MODELS).filter((f) => f.endsWith('.glb') && !KEEP.some((n) => f.includes(n))
  && (!only.length || only.some((n) => f.includes(n))));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ktx2-'));

for (const f of files) {
  const file = path.join(MODELS, f);
  const before = fs.statSync(file).size;
  const doc = await io.read(file);
  const root = doc.getRoot();
  const textures = root.listTextures().filter((t) => t.getMimeType() !== 'image/ktx2');
  if (!textures.length) { console.log(f.padEnd(34), 'already done'); continue; }
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  for (const t of textures) {
    const normal = root.listMaterials().some((m) => m.getNormalTexture() === t);
    const src = path.join(tmp, 'in' + (t.getMimeType() === 'image/png' ? '.png' : '.jpg'));
    const out = path.join(tmp, 'out.ktx2');
    fs.writeFileSync(src, t.getImage());
    const uastc = CLOSE.some((n) => f.includes(n));
    const codec = uastc ? ['-uastc', '-quality', '85', '-effort', '4'] : ['-etc1s', '-q', '255'];
    execFileSync('basisu', [src, ...codec, '-mipmap', ...(normal ? ['-linear'] : []), '-output_file', out], { stdio: 'ignore' });
    const [w, h] = t.getSize() ?? [0, 0];
    t.setImage(new Uint8Array(fs.readFileSync(out))).setMimeType('image/ktx2');
    console.log(`  ${f} ${normal ? 'normal' : 'colour'} ${w}x${h} ${uastc ? 'UASTC' : 'ETC1S'}: ${(fs.statSync(src).size / 1e6).toFixed(2)} MB -> ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
  }
  await io.write(file, doc);
  console.log(f.padEnd(34), `${(before / 1e6).toFixed(2)} MB -> ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
}
fs.rmSync(tmp, { recursive: true, force: true });
