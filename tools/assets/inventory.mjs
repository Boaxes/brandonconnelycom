// usage: node inventory.mjs [dir]   every texture in the models: size, kind, format, bytes
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2] || path.resolve(import.meta.dirname, '../../public/models');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const tot = {};
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.glb')).sort()) {
  const doc = await io.read(path.join(dir, f));
  for (const t of doc.getRoot().listTextures()) {
    const normal = doc.getRoot().listMaterials().some((m) => m.getNormalTexture() === t);
    const [w] = t.getSize() ?? [0];
    const k = `${normal ? 'normal' : 'colour'} ${w}`;
    tot[k] = tot[k] || { n: 0, bytes: 0, files: [] };
    tot[k].n++; tot[k].bytes += t.getImage().byteLength; tot[k].files.push(f.replace('scan_', '').replace('.glb', ''));
  }
}
for (const [k, v] of Object.entries(tot).sort()) console.log(k.padEnd(14), String(v.n).padStart(3), 'textures', (v.bytes / 1e6).toFixed(1).padStart(6), 'MB  ', v.files.join(' '));
