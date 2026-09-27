// usage: node extract.mjs <file.glb> <outdir>   write a model's texture images out as files
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import fs from 'node:fs';
const [file, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
doc.getRoot().listTextures().forEach((t, i) => {
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/ktx2': 'ktx2' }[t.getMimeType()] ?? 'bin';
  const normal = doc.getRoot().listMaterials().some((m) => m.getNormalTexture() === t);
  fs.writeFileSync(`${out}/t${i}-${normal ? 'normal' : 'colour'}.${ext}`, t.getImage());
});
