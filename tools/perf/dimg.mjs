// usage: node dimg.mjs <a.png> <b.png> <out.png> [gain]   (amplified difference image)
import { PNG } from 'pngjs';
import fs from 'node:fs';
const [a, b, out, k = 8] = process.argv.slice(2);
const A = PNG.sync.read(fs.readFileSync(a)), B = PNG.sync.read(fs.readFileSync(b));
const O = new PNG({ width: A.width, height: A.height });
for (let i = 0; i < A.data.length; i += 4) { for (let c = 0; c < 3; c++) O.data[i + c] = Math.min(255, Math.abs(A.data[i + c] - B.data[i + c]) * k); O.data[i + 3] = 255; }
fs.writeFileSync(out, PNG.sync.write(O));
