// usage: node diff.mjs <dir-a> <dir-b>   (per-frame max/mean channel difference of same-named PNGs)
import { PNG } from 'pngjs';
import fs from 'node:fs';
const [a, b] = process.argv.slice(2);
for (const f of fs.readdirSync(a).filter((f) => f.endsWith('.png')).sort()) {
  if (!fs.existsSync(`${b}/${f}`)) continue;
  const A = PNG.sync.read(fs.readFileSync(`${a}/${f}`)), B = PNG.sync.read(fs.readFileSync(`${b}/${f}`));
  if (A.width !== B.width || A.height !== B.height) { console.log(f, 'size differs', A.width, B.width); continue; }
  let max = 0, sum = 0, n1 = 0, n4 = 0; const hist = new Array(256).fill(0);
  for (let i = 0; i < A.data.length; i += 4) for (let c = 0; c < 3; c++) {
    const d = Math.abs(A.data[i + c] - B.data[i + c]); max = Math.max(max, d); sum += d; hist[d]++; if (d > 1) n1++; if (d > 4) n4++;
  }
  const n = A.width * A.height * 3;
  console.log(f.padEnd(14), `max ${max}  mean ${(sum / n).toFixed(4)}  >1: ${(100 * n1 / n).toFixed(3)}%  >4: ${(100 * n4 / n).toFixed(4)}%`);
}
