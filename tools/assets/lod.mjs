// usage: node lod.mjs [name ...]   (no names: every animal scan in public/models)
//
// Levels of detail for the animals: each scan gets two simpler versions of its mesh (about a quarter and
// a twelfth of the triangles), made by meshoptimizer's simplifier (by shape; it keeps the UV seams, so
// the textures stay where they were). They share the original's vertices (only the triangle list is new)
// and textures, and each records how far its surface strays from the original's (`lodError`, in the
// mesh's units): the site swaps to one only where that's under half a pixel on screen (see Species.ts).
// A level that saves little over the one before isn't kept.
// They're nodes named lod1, lod2 beside the original. Scans that already have them are skipped.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

const MODELS = path.resolve(import.meta.dirname, '../../public/models');
/** the scans that move about, in numbers; the scenery is left alone */
const ANIMALS = ['herring', 'salmon', 'rockfish_copper', 'rockfish_black', 'giant_pacific_octopus', 'crab_dungeness', 'crab_helmet',
  'crab_kelp', 'crab_decorator', 'sunflower_star', 'urchin', 'bat_star', 'scallop', 'harbor_porpoise', 'sea_cucumber', 'starry_flounder',
  'sculpin', 'prawn', 'dogfish', 'ca_sea_lion', 'orca', 'humpback', 'sand_dollar', 'moon_snail'];
const LEVELS = [0.25, 0.08];
const MIN_TRIANGLES = 60;

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const only = process.argv.slice(2);

for (const key of ANIMALS.filter((k) => !only.length || only.some((n) => k.includes(n)))) {
  const file = path.join(MODELS, `scan_${key}.glb`);
  if (!fs.existsSync(file)) continue;
  const doc = await io.read(file);
  const root = doc.getRoot();
  if (root.listNodes().some((n) => /^lod\d$/.test(n.getName()))) { console.log(key.padEnd(24), 'already has levels'); continue; }
  const node0 = root.listNodes().find((n) => n.getMesh());
  const prim = node0.getMesh().listPrimitives()[0];
  const pos = prim.getAttribute('POSITION').getArray();
  const indices = Uint32Array.from(prim.getIndices().getArray());
  const scale = MeshoptSimplifier.getScale(pos, 3);
  const parent = node0.getParentNode() ?? root.listScenes()[0];
  const out = [];
  let last = indices.length;
  let k = 0;
  for (const ratio of LEVELS) {
    const target = Math.max(MIN_TRIANGLES, Math.floor((indices.length / 3) * ratio)) * 3;
    const [idx, err] = MeshoptSimplifier.simplify(indices, pos, 3, target, 1, []);
    if (idx.length > last * 0.85) break;
    last = idx.length;
    k++;
    const acc = doc.createAccessor(`lod${k}-indices`).setType('SCALAR').setArray(idx).setBuffer(prim.getIndices().getBuffer());
    const p = prim.clone().setIndices(acc);
    const mesh = doc.createMesh(`lod${k}`).addPrimitive(p);
    const node = doc.createNode(`lod${k}`).setMesh(mesh).setMatrix(node0.getMatrix()).setExtras({ lodError: err * scale, lodTriangles: idx.length / 3 });
    parent.addChild(node);
    out.push(`${idx.length / 3} tris, error ${(err * scale * 1000).toFixed(2)} mm`);
  }
  if (!k) { console.log(key.padEnd(24), 'no level worth keeping'); continue; }
  await io.write(file, doc);
  console.log(key.padEnd(24), `${indices.length / 3} tris ->`, out.join(' | '));
}
