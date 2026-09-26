/**
 * The animated, hand-inked diagrams on the portfolio pages. Each has a still part (boxes and arrows, drawn
 * once with the page) and a moving part (red ink dots carrying data along the arrows, and readouts that
 * change inside the boxes), drawn over it every frame while the page is open.
 */
import {
  CARD, INK, INK2, INK3, RED, type G, label, penArrow, penBox, serifFont, travel, typeFont,
} from './ink';
import { runModel, POLICY, type Year } from './tourismModel';

type Pt = [number, number];

interface Box { x: number; y: number; w: number; h: number; title: string; sub?: string }

function card(g: G, b: Box, seed: number, o: { titleSize?: number; subSize?: number } = {}) {
  penBox(g, b.x, b.y, b.w, b.h, seed, { fill: CARD });
  label(g, b.title, b.x + b.w / 2, b.y + 28, typeFont(o.titleSize ?? 26), INK, b.w - 20);
  if (b.sub) label(g, b.sub, b.x + b.w / 2, b.y + 58, serifFont(o.subSize ?? 20, true), INK2, b.w - 20);
}

/** A readout line near the bottom of a box: red while fresh, settling to ink. */
function readout(g: G, b: Box, text: string, fresh = 0, dy = 0) {
  if (!text) return;
  const k = Math.max(0, Math.min(1, fresh));
  const col = k > 0 ? RED : INK;
  label(g, text, b.x + b.w / 2, b.y + b.h - 24 + dy, typeFont(21), col, b.w - 18);
}

/** Phase of a repeating cycle: 0..1 through period `p`, plus which cycle it is. */
function cycle(t: number, p: number, offset = 0) {
  const x = (t + offset) / p;
  return { u: x - Math.floor(x), n: Math.floor(x) };
}

/** Progress of u through the window [a, b] (may be <0 or >1 outside it). */
const span = (u: number, a: number, b: number) => (u - a) / (b - a);

// ------------------------------------------------------------------ About: the path data takes

export function aboutSketch(x: number, y: number, w: number) {
  const gap = 58;
  const bw = (w - 3 * gap) / 4, bh = 92;
  const names: [string, string][] = [['sources', 'drives, old DBs'], ['pipelines', 'dbt, Python'], ['Postgres', 'in the cloud'], ['answers', 'SQL, Power BI']];
  const boxes: Box[] = names.map(([t, s], i) => ({ x: x + i * (bw + gap), y, w: bw, h: bh, title: t, sub: s }));
  const paths: Pt[][] = boxes.slice(0, 3).map((b) => [[b.x + b.w + 6, b.y + bh / 2], [b.x + b.w + gap - 6, b.y + bh / 2]]);
  return {
    /** where `live` draws */
    area: { x: x - 12, y: y - 12, w: w + 24, h: bh + 24 },
    still(g: G) {
      boxes.forEach((b, i) => card(g, b, 400 + i * 11, { titleSize: 25, subSize: 18 }));
      paths.forEach((p, i) => penArrow(g, p, 470 + i * 5, { width: 1.8 }));
    },
    live(g: G, t: number) {
      paths.forEach((p, i) => {
        for (let k = 0; k < 2; k++) {
          const { u } = cycle(t, 2.4, i * 0.8 + k * 1.2);
          travel(g, p, span(u, 0, 0.5), RED, 5);
        }
      });
    },
  };
}

// ------------------------------------------------------------------ Cascadia: the data platform

const RECORDS: { raw: string; rule: string; clean: string }[] = [
  { raw: 'humpbak whale', rule: 'species name', clean: 'Humpback Whale' },
  { raw: '47.61, 122.33', rule: 'coordinates', clean: '47.61, −122.33' },
  { raw: 'Harbour porp.', rule: 'species name', clean: 'Harbor Porpoise' },
  { raw: 'sighting 4417', rule: 'orphaned row', clean: '→ its survey' },
  { raw: 'Dalls porpoise', rule: 'species name', clean: "Dall's Porpoise" },
  { raw: 'KILLER WHALE', rule: 'species name', clean: 'Killer Whale' },
];
const HEADERS = ['Lat,Long,TIME', 'latitude;lon;t', 'LAT  LON  Time'];

/** The Cascadia pipeline, `w` wide, top-left at (x, y). About 500 px tall. */
export function cascadiaPipeline(x: number, y: number, w: number) {
  const c1 = x, c2 = x + w * 0.31, c3 = x + w * 0.62;
  const bw1 = w * 0.25, bw2 = w * 0.25, bw3 = w * 0.36;
  const vm = { x: c3 - 18, y, w: w - (c3 - 18 - x) + 6, h: 318 };
  const r1: Box[] = [
    { x: c1, y: y + 42, w: bw1, h: 118, title: 'SQL Server', sub: 'legacy database' },
    { x: c2, y: y + 42, w: bw2, h: 118, title: 'dbt', sub: 'cleanup rules' },
    { x: c3, y: y + 42, w: bw3, h: 118, title: 'Postgres', sub: 'with PostGIS' },
  ];
  const r2: Box[] = [
    { x: c1, y: y + 192, w: bw1, h: 116, title: 'GitHub', sub: 'every change' },
    { x: c2, y: y + 192, w: bw2, h: 116, title: 'CI / CD', sub: 'checked, shipped' },
    { x: c3, y: y + 192, w: bw3, h: 116, title: 'Django app', sub: 'maps, filters, edits' },
  ];
  const r3: Box[] = [
    { x: c1, y: y + 372, w: bw1, h: 118, title: 'GPS tracks', sub: 'on Google Drive' },
    { x: c2, y: y + 372, w: bw2, h: 118, title: 'Python', sub: 'one layout' },
    { x: c3, y: y + 372, w: bw3, h: 118, title: 'Object storage', sub: 'track files' },
  ];
  const across = (row: Box[], i: number): Pt[] => {
    const a = row[i], b = row[i + 1];
    const yy = a.y + a.h / 2;
    return [[a.x + a.w + 6, yy], [b.x - 8, yy]];
  };
  const mid = c3 + bw3 / 2;
  const dbDown: Pt[] = [[mid - 34, r1[2].y + r1[2].h + 4], [mid - 34, r2[2].y - 6]];
  const dbUp: Pt[] = [[mid + 34, r2[2].y - 4], [mid + 34, r1[2].y + r1[2].h + 6]];
  const tracksUp: Pt[] = [[mid, r3[2].y - 6], [mid, r2[2].y + r2[2].h + 8]];

  return {
    height: 490,
    /** where `live` draws */
    area: { x: x - 16, y: y - 12, w: w + 32, h: 490 + 24 },
    still(g: G) {
      penBox(g, vm.x, vm.y, vm.w, vm.h, 0, { dash: true });
      label(g, 'DIGITALOCEAN SERVER', vm.x + 14, vm.y + 20, typeFont(19), INK3, vm.w - 20, 'left');
      [...r1, ...r2, ...r3].forEach((b, i) => card(g, b, 100 + i * 17));
      for (const [row, s] of [[r1, 10], [r2, 20], [r3, 30]] as const) {
        penArrow(g, across(row, 0), s);
        penArrow(g, across(row, 1), s + 3);
      }
      penArrow(g, dbDown, 41, { width: 1.8 });
      penArrow(g, dbUp, 43, { width: 1.8 });
      penArrow(g, tracksUp, 47, { width: 1.8 });
      label(g, 'joined to sightings', mid + 12, (tracksUp[0][1] + tracksUp[1][1]) / 2, serifFont(18, true), INK2, 200, 'left');
    },
    live(g: G, t: number) {
      // row 1: one record at a time goes through the rules and comes out clean
      {
        const { u, n } = cycle(t, 2.6);
        const rec = RECORDS[n % RECORDS.length];
        const prev = RECORDS[(n + RECORDS.length - 1) % RECORDS.length];
        readout(g, r1[0], rec.raw, 1 - span(u, 0.1, 0.4));
        travel(g, across(r1, 0), span(u, 0.12, 0.36));
        const inRule = u > 0.36 && u < 0.62;
        readout(g, r1[1], inRule ? rec.rule : '', 1);
        travel(g, across(r1, 1), span(u, 0.6, 0.82));
        const done = u > 0.82;
        readout(g, r1[2], done ? rec.clean : prev.clean, done ? 1 - span(u, 0.82, 1) : 0);
      }
      // the app and the database talk both ways
      {
        const a = cycle(t, 1.6);
        travel(g, dbDown, span(a.u, 0, 0.45), RED, 5);
        travel(g, dbUp, span(a.u, 0.5, 0.95), RED, 5);
      }
      // row 2: a change goes out
      {
        const { u } = cycle(t, 4.4, 1.1);
        readout(g, r2[0], 'git push', u < 0.3 ? 1 : 0);
        travel(g, across(r2, 0), span(u, 0.08, 0.3));
        readout(g, r2[1], u > 0.3 && u < 0.6 ? 'checks ✓' : '', 1);
        travel(g, across(r2, 1), span(u, 0.55, 0.75));
        readout(g, r2[2], u > 0.75 ? 'deployed' : 'live', u > 0.75 ? 1 - span(u, 0.75, 1) : 0);
      }
      // row 3: every track file gets the same layout
      {
        const { u, n } = cycle(t, 3.2, 0.7);
        readout(g, r3[0], HEADERS[n % HEADERS.length], 1 - span(u, 0.1, 0.4));
        travel(g, across(r3, 0), span(u, 0.12, 0.36));
        readout(g, r3[1], u > 0.36 && u < 0.62 ? 'headers' : '', 1);
        travel(g, across(r3, 1), span(u, 0.6, 0.8));
        readout(g, r3[2], 'lat · lon · time', u > 0.8 ? 1 - span(u, 0.8, 1) : 0);
        travel(g, tracksUp, span(u, 0.82, 1), RED, 5);
      }
    },
  };
}

// ------------------------------------------------------------------ Tourism: the model, running

const fmtM = (v: number) => `${(v / 1e6).toFixed(2)}M`;
const fmt$ = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${Math.round(v / 1e6)}M`);
const fmtT = (v: number) => `${(v / 1e6).toFixed(2)}M t`;

/** The tourism model as a flow diagram, running year by year. About 600 px tall. */
export function tourismModel(x: number, y: number, w: number) {
  const years = runModel();
  // the state before the policy starts (what the scores are measured against)
  const start: Year = {
    year: 0, visitors: 1.6e6, gained: 0, lossPct: 1, money: { infra: 0, programs: 0, conservation: 0 },
    capacity: 1.6e6, crowded: false, revenue: 1.6e6 * 250, carbon: 1.6e6 * 2 + 280_000, carbonScore: 1, revenueScore: 1, E: 1,
  };
  const bw = (w - 60) / 3;
  const col = (i: number) => x + i * (bw + 30);
  const visitors: Box = { x: col(0), y, w: bw, h: 110, title: 'Visitors', sub: 'fewer come as tax rises' };
  const taxed: Box = { x: col(1), y, w: bw, h: 110, title: 'Tax collected', sub: `$${POLICY.tax} each` };
  const yearBox: Box = { x: col(2), y, w: bw, h: 110, title: '' };
  const cy = y + 176;
  const chipW = (w - 40) / 3;
  const chips: Box[] = [
    { x: x, y: cy, w: chipW, h: 84, title: 'Infrastructure' },
    { x: x + chipW + 20, y: cy, w: chipW, h: 84, title: 'Programs' },
    { x: x + 2 * (chipW + 20), y: cy, w: chipW, h: 84, title: 'Conservation' },
  ];
  const shares = [POLICY.infra, POLICY.programs, POLICY.conservation];
  const ry = y + 336;
  const capacity: Box = { x: col(0), y: ry, w: bw, h: 112, title: 'Capacity', sub: 'grows with infrastructure' };
  const revenue: Box = { x: col(1), y: ry, w: bw, h: 112, title: 'Revenue', sub: 'less when crowded' };
  const carbon: Box = { x: col(2), y: ry, w: bw, h: 112, title: 'Carbon', sub: 'cut by all three' };
  const E: Box = { x: x + 40, y: y + 500, w: w - 80, h: 140, title: '' };

  const cxOf = (b: Box) => b.x + b.w / 2;
  const bus = cy + 108;
  const tick = (c: Box) => cxOf(c) + 36;
  // loops back to the visitors run down the left margin, clear of everything else
  const m1 = x - 24, m2 = x - 50;
  const P = {
    vt: [[visitors.x + visitors.w + 4, y + 55], [taxed.x - 6, y + 55]] as Pt[],
    split: chips.map((c) => [[cxOf(taxed) + (cxOf(c) - cxOf(taxed)) * 0.3, y + 114], [cxOf(c), cy - 6]] as Pt[]),
    loop: [[x - 4, cy + 42], [m1, cy + 42], [m1, y + 70], [x - 6, y + 70]] as Pt[],
    capVis: [[x - 4, ry + 56], [m2, ry + 56], [m2, y + 36], [x - 6, y + 36]] as Pt[],
    toCap: [[cxOf(chips[0]) - 40, cy + 88], [cxOf(capacity) - 40, ry - 6]] as Pt[],
    ticks: chips.map((c) => [[tick(c), cy + 88], [tick(c), bus]] as Pt[]),
    bus: [[tick(chips[0]), bus], [tick(chips[2]), bus]] as Pt[],
    busDown: [[cxOf(carbon), bus], [cxOf(carbon), ry - 6]] as Pt[],
    capRev: [[capacity.x + capacity.w + 4, ry + 56], [revenue.x - 6, ry + 56]] as Pt[],
    revE: [[cxOf(revenue), ry + 116], [cxOf(revenue), E.y - 6]] as Pt[],
    carbonE: [[cxOf(carbon), ry + 116], [cxOf(carbon) - 70, E.y - 6]] as Pt[],
  };
  const vlabel = (g: G, text: string, lx: number, y0: number, y1: number) => {
    g.save();
    g.translate(lx, (y0 + y1) / 2);
    g.rotate(-Math.PI / 2);
    label(g, text, 0, 0, serifFont(17, true), INK2, Math.abs(y1 - y0) - 10);
    g.restore();
  };

  // playback: each year takes YEAR seconds, stages light up in order; the last year holds, then it restarts
  const YEAR = 1.15;
  const HOLD = 4;
  const total = years.length * YEAR + HOLD;
  const at = (t: number) => {
    const s = t % total;
    const i = Math.min(years.length - 1, Math.floor(s / YEAR));
    const u = s >= years.length * YEAR ? 1 : (s - i * YEAR) / YEAR;
    return { i, u, holding: s >= years.length * YEAR };
  };
  const stage = { visitors: 0.05, taxed: 0.22, chips: 0.4, results: 0.62, E: 0.84 };

  return {
    height: 650,
    /** where `live` draws (the loops back to the visitors run down the left margin) */
    area: { x: m2 - 14, y: y - 12, w: x + w - m2 + 26, h: 650 + 24 },
    still(g: G) {
      card(g, visitors, 700);
      card(g, taxed, 703);
      penBox(g, yearBox.x, yearBox.y, yearBox.w, yearBox.h, 706, { dash: true });
      chips.forEach((c, i) => card(g, c, 710 + i * 3, { titleSize: 23 }));
      card(g, capacity, 720);
      card(g, revenue, 723);
      card(g, carbon, 726);
      penBox(g, E.x, E.y, E.w, E.h, 729, { fill: CARD });
      penArrow(g, P.vt, 730);
      P.split.forEach((p, i) => {
        penArrow(g, p, 740 + i * 4, { width: 1.8 });
        const lx = p[0][0] + (p[1][0] - p[0][0]) * 0.55 + (i === 0 ? -30 : i === 1 ? 28 : 30);
        label(g, `${Math.round(shares[i] * 100)}%`, lx, p[0][1] + (p[1][1] - p[0][1]) * 0.55, typeFont(20), RED);
      });
      penArrow(g, P.loop, 750, { dash: true, width: 1.6 });
      vlabel(g, 'next year', m1 - 12, y + 70, cy + 42);
      penArrow(g, P.capVis, 752, { dash: true, width: 1.6 });
      vlabel(g, 'caps visitors', m2 - 12, cy + 60, ry + 56);
      penArrow(g, P.toCap, 754, { width: 1.6 });
      P.ticks.forEach((p, i) => penArrow(g, p, 756 + i * 3, { width: 1.6, head: false }));
      penArrow(g, P.bus, 762, { width: 1.6, head: false });
      penArrow(g, P.busDown, 764, { width: 1.8 });
      penArrow(g, P.capRev, 766, { width: 1.6 });
      penArrow(g, P.revE, 768, { width: 1.8 });
      penArrow(g, P.carbonE, 770, { width: 1.8 });
      label(g, 'environmental-economic score, by year', E.x + E.w - 16, E.y + 16, serifFont(16, true), INK3, 320, 'right');
    },
    live(g: G, t: number) {
      const { i, u, holding } = at(t);
      const cur = years[i];
      const prev = i > 0 ? years[i - 1] : start;
      const pick = (s: number) => (u >= s ? cur : prev);
      const fresh = (s: number) => (u >= s ? 1 - Math.min(1, (u - s) / 0.25) : 0);

      // year counter
      label(g, `YEAR ${String(cur.year).padStart(2, ' ')}`, cxOf(yearBox), yearBox.y + 40, typeFont(36), INK);
      label(g, holding ? `after ${years.length} years` : `of ${years.length}`, cxOf(yearBox), yearBox.y + 76, serifFont(20, true), INK2);

      readout(g, visitors, fmtM(pick(stage.visitors).visitors), fresh(stage.visitors));
      readout(g, taxed, fmt$(pick(stage.taxed).visitors * POLICY.tax), fresh(stage.taxed));
      const m = pick(stage.chips).money;
      [m.infra, m.programs, m.conservation].forEach((v, k) => readout(g, chips[k], fmt$(v), fresh(stage.chips), 4));
      const r = pick(stage.results);
      readout(g, capacity, fmtM(r.capacity), fresh(stage.results));
      readout(g, revenue, fmt$(r.revenue), fresh(stage.results));
      readout(g, carbon, fmtT(r.carbon), fresh(stage.results));
      if (r.crowded) label(g, 'crowded', revenue.x + revenue.w - 12, revenue.y + 14, typeFont(16), RED, 100, 'right');

      if (!holding) {
        travel(g, P.vt, span(u, stage.visitors, stage.taxed));
        P.split.forEach((p) => travel(g, p, span(u, stage.taxed, stage.chips), RED, 6));
        travel(g, P.toCap, span(u, stage.chips, stage.results), RED, 5);
        travel(g, [...P.ticks[0], ...P.bus.slice(1), ...P.busDown.slice(1)], span(u, stage.chips, stage.results), RED, 5);
        travel(g, P.capRev, span(u, stage.results - 0.08, stage.results + 0.06), RED, 5);
        travel(g, P.revE, span(u, stage.results, stage.E), RED, 6);
        travel(g, P.carbonE, span(u, stage.results, stage.E), RED, 6);
        travel(g, P.loop, span(u, stage.E, 1), RED, 5);
        travel(g, P.capVis, span(u, stage.results, stage.E + 0.1), RED, 4);
      }

      // the score, and its history so far
      const e = pick(stage.E);
      const shown = u >= stage.E ? i : i - 1;
      label(g, 'E', E.x + 40, E.y + 44, typeFont(40), INK);
      label(g, e.E.toFixed(2), E.x + 128, E.y + 44, typeFont(40), fresh(stage.E) > 0 ? RED : INK);
      label(g, `carbon ${e.carbonScore.toFixed(2)}`, E.x + 24, E.y + 88, typeFont(19), INK2, 220, 'left');
      label(g, `revenue ${e.revenueScore.toFixed(2)}`, E.x + 24, E.y + 114, typeFont(19), INK2, 220, 'left');
      const gx = E.x + 250, gy = E.y + 32, gw = E.w - 274, gh = E.h - 54;
      const lo = 0.85, hi = 1.35;
      const px = (k: number) => gx + (k / (years.length - 1)) * gw;
      const py = (v: number) => gy + gh - ((v - lo) / (hi - lo)) * gh;
      g.save();
      g.strokeStyle = INK3;
      g.lineWidth = 1;
      g.setLineDash([4, 6]);
      g.beginPath(); g.moveTo(gx, py(1)); g.lineTo(gx + gw, py(1)); g.stroke();
      g.setLineDash([]);
      g.strokeStyle = INK;
      g.beginPath(); g.moveTo(gx, gy + gh); g.lineTo(gx + gw, gy + gh); g.moveTo(gx, gy); g.lineTo(gx, gy + gh); g.stroke();
      g.restore();
      label(g, '1.0', gx - 8, py(1), typeFont(15), INK3, 60, 'right');
      label(g, 'year 1', gx, gy + gh + 13, typeFont(15), INK3, 80, 'left');
      label(g, `${years.length}`, gx + gw, gy + gh + 13, typeFont(15), INK3, 80, 'right');
      if (shown >= 0) {
        g.save();
        g.strokeStyle = RED;
        g.lineWidth = 2.6;
        g.lineJoin = 'round';
        g.beginPath();
        for (let k = 0; k <= shown; k++) {
          if (k === 0) g.moveTo(px(k), py(years[k].E)); else g.lineTo(px(k), py(years[k].E));
        }
        g.stroke();
        g.fillStyle = RED;
        g.beginPath(); g.arc(px(shown), py(years[shown].E), 4.5, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    },
  };
}
