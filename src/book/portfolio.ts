import { content } from '../content';
import { CC0_NOTE, CREDITS } from '../credits';
import { flow, Page, PAGE_W, pixelRect, TYPE, type Block, type PageStyle } from './Page';
import { INK, INK2, INK3, RED, Print, caption, label, para, penLine, serifFont, tape, typeFont, type G } from './ink';
import { picture, clip, newFrames, type Picture, type Clip } from './media';
import { aboutSketch, cascadiaPipeline, tourismModel } from './diagrams';

const STYLE: PageStyle = {
  paper: '#f1e9d6',
  ink: '#2a2622',
  ink2: '#5a544b',
  ink3: '#8c8475',
  accent: '#7d2a22',
};

const L = 100;                 // left margin
const R = PAGE_W - 84;         // right margin
const W = R - L;

export interface Section { id: string; label: string; page: number }

// ------------------------------------------------------------------ type on a composed page

/** Section name, typed small at the head of the page. */
function header(g: G, text: string) {
  g.save();
  g.font = `24px ${TYPE}`;
  g.fillStyle = INK3;
  g.fillText(text.toUpperCase(), L, 76);
  g.restore();
}

function title(g: G, text: string, y: number, size = 40) {
  label(g, text, L, y + size * 0.6, typeFont(size), INK, W, 'left');
  return y + size * 1.3;
}

function meta(g: G, text: string, y: number) {
  return para(g, text.toUpperCase(), L, y, W, { font: typeFont(22), size: 22, lh: 32, color: INK3 }) + 6;
}

/** A link: accent-coloured, underlined, clickable. Returns the y below it. */
function link(p: Page, text: string, target: { href?: string; page?: number }, x: number, y: number, size = 25) {
  const g = p.g;
  g.save();
  g.font = typeFont(size);
  const w = g.measureText(text).width;
  g.fillStyle = STYLE.accent;
  g.textBaseline = 'alphabetic';
  g.fillText(text, x, y + size);
  g.strokeStyle = STYLE.accent;
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(x, y + size + 6); g.lineTo(x + w, y + size + 6); g.stroke();
  g.restore();
  p.hit(x - 10, y - 4, w + 20, size + 18, target);
  return y + size + 22;
}

const short = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** A bullet of prose, with an optional typed lead-in word. */
function note(g: G, text: string, y: number, lead?: string, size = 26) {
  const lh = size * 1.45;
  g.save();
  g.fillStyle = RED;
  g.beginPath(); g.arc(L + 6, y + size * 0.62, 4, 0, Math.PI * 2); g.fill();
  g.restore();
  return para(g, (lead ? lead + ' ' : '') + text, L + 28, y, W - 28, { size, lh }) + 10;
}

// ------------------------------------------------------------------ the pages

/** A composed page: `draw` lays it out (again whenever a picture arrives); `live` animates it. */
function composed(number: number | undefined, draw: (p: Page) => void, live?: (g: G, t: number) => void) {
  const p = new Page(STYLE, number);
  p.compose = draw;
  if (live) p.live = live;
  p.rebuild();
  return p;
}

function contentsPage(entries: { label: string; page: number; indent?: boolean; group?: boolean }[]) {
  return composed(undefined, (p) => {
    const g = p.g;
    label(g, content.fullName.toUpperCase(), PAGE_W / 2, 150, typeFont(40), INK, W);
    label(g, 'PORTFOLIO', PAGE_W / 2, 200, typeFont(24), INK3, W);
    penLine(g, PAGE_W / 2 - 80, 232, PAGE_W / 2 + 80, 232, 5, 2, RED);
    let y = title(g, 'Contents', 300, 44) + 20;
    for (const e of entries) {
      const x = e.indent ? L + 44 : L;
      if (e.group) {
        label(g, e.label, x, y + 22, typeFont(30), INK, W, 'left');
        y += 58;
        continue;
      }
      const num = String(e.page + 1);
      g.save();
      g.font = serifFont(31);
      const tw = g.measureText(e.label).width;
      g.fillStyle = INK;
      g.fillText(e.label, x, y + 32);
      g.font = typeFont(28);
      const nw = g.measureText(num).width;
      g.fillText(num, R - nw, y + 32);
      // dot leaders
      g.fillStyle = INK3;
      for (let dx = x + tw + 16; dx < R - nw - 14; dx += 14) g.fillRect(dx, y + 29, 2.5, 2.5);
      g.restore();
      p.hit(x - 12, y - 6, R - x + 24, 54, { page: e.page });
      y += 58;
    }
    penLine(g, L, y + 40, L + 120, y + 40, 6, 2, RED);
    para(g, 'Click a line to turn straight to it. Click the right-hand page to go on, the left to go back; scroll over the page to read closer.',
      L, y + 64, W, { size: 25, lh: 38, italic: true, color: INK2 });
  });
}

function aboutPage(n: number) {
  const sketch = aboutSketch(L + 10, 0, W - 20);
  let sketchY = 0;
  return composed(n, (p) => {
    const g = p.g;
    header(g, 'About');
    let y = title(g, 'About', 136, 50) + 22;
    y = para(g, content.about.lead, L, y, W, { size: 36, lh: 54 }) + 44;
    content.about.points.forEach((pt, i) => {
      label(g, `${i + 1}.`, L, y + 20, typeFont(31), RED, 60, 'left');
      label(g, pt.title, L + 46, y + 20, typeFont(31), INK, W - 46, 'left');
      y = para(g, pt.text, L + 46, y + 50, W - 46, { size: 30, lh: 46 }) + 36;
    });
    sketchY = y + 20;
    const a = sketch.area;
    p.liveRects = [pixelRect(a.x, a.y + sketchY, a.w, a.h)];
    g.save();
    g.translate(0, sketchY);
    sketch.still(g);
    g.restore();
    y = sketchY + 92 + 60;
    para(g, content.about.close, L, y, W, { size: 30, lh: 46, italic: true });
  }, (g, t) => {
    g.save();
    g.translate(0, sketchY);
    sketch.live(g, t);
    g.restore();
  });
}

function cascadiaLeft(n: number) {
  const c = content.cascadia;
  let diagram: ReturnType<typeof cascadiaPipeline> | null = null;
  return composed(n, (p) => {
    const g = p.g;
    header(g, 'Experience');
    let y = title(g, c.org, 118);
    y = meta(g, `${c.role} · ${c.when}`, y);
    y = para(g, c.intro, L, y + 8, W, { size: 27, lh: 39 }) + 22;
    diagram = cascadiaPipeline(L, y, W);
    p.liveRects = [pixelRect(diagram.area.x, diagram.area.y, diagram.area.w, diagram.area.h)];
    diagram.still(g);
    y += diagram.height + 26;
    c.notes.forEach((t) => { y = note(g, t, y, undefined, 24); });
  }, (g, t) => diagram?.live(g, t));
}

function cascadiaRight(n: number) {
  const c = content.cascadia;
  const p = new Page(STYLE, n);
  const shots: Picture[] = [picture('cascadia-overview.jpg', p), picture('cascadia-filter.jpg', p), picture('cascadia-sighting.jpg', p)];
  const prints = [
    new Print(L + 8, 0, 400, 400, -0.035, 3, 14, ['tl', 'br']),
    new Print(L + 452, 0, 360, 360, 0.042, 4, 14, ['tr', 'bl']),
    new Print(L + 470, 0, 340, 340, -0.025, 5, 14, ['tr', 'bl']),
  ];
  p.compose = (p) => {
    const g = p.g;
    header(g, 'Experience');
    let y = title(g, c.appTitle, 118);
    y = para(g, c.app, L, y + 4, W, { size: 27, lh: 39 }) + 40;
    prints[0].y = y;
    prints[1].y = y + 40;
    prints[2].y = y + 490;
    prints.forEach((pr, i) => { pr.back(g); pr.picture(g, shots[i].img); pr.tapes(g); });
    caption(g, 'fig. 1  sightings & survey tracks', prints[0].x, prints[0].y + 440, 21);
    caption(g, 'fig. 2  filtering by species', prints[1].x + 20, prints[1].y + 400, 21);
    caption(g, 'fig. 3  one sighting \u2192', L + 8, prints[2].y + 60, 21);
    caption(g, '(sample IDs blurred)', L + 8, prints[2].y + 90, 19, INK3);
    penLine(g, L + 8, prints[2].y + 150, L + 128, prints[2].y + 150, 12, 2, RED);
    para(g, c.people, L + 8, prints[2].y + 176, 380, { size: 25, lh: 38, italic: true, color: INK2 });
  };
  p.rebuild();
  return p;
}

function wwuLeft(n: number) {
  const c = content.wwu;
  return composed(n, (p) => {
    const g = p.g;
    header(g, 'Experience');
    let y = title(g, c.org, 118);
    y = meta(g, `${c.role} · ${c.when}`, y);
    y = link(p, short(c.repo) + ' →', { href: c.repo }, L, y + 2, 23) + 6;
    y = para(g, c.intro, L, y + 10, W, { size: 30, lh: 45 }) + 40;
    label(g, 'Three numerical experiments', L, y + 16, typeFont(28), INK, W, 'left');
    y += 52;
    c.experiments.forEach((t, i) => { y = note(g, t, y, `${i + 1}.`, 28) + 6; });
    y = para(g, c.papers, L, y + 20, W, { size: 27, lh: 40, italic: true, color: INK2 }) + 24;
    meta(g, c.stack, y);
  });
}

function wwuRight(n: number) {
  const p = new Page(STYLE, n);
  const files = ['wwu-permittivity.jpg', 'wwu-coarse.jpg', 'wwu-holst.jpg', 'wwu-l2.jpg'];
  const pics = files.map((f) => picture(f, p));
  const caps: [string, string][] = [
    ['setup', 'molecule in solvent, by permittivity'],
    ['solve', 'the potential on a coarse mesh'],
    ['verify', "finite elements vs Holst's formula"],
    ['converge', 'error falls as the mesh refines'],
  ];
  const s = 360;
  const prints = [
    new Print(L + 14, 140, s, s, -0.03, 11, 14, ['tl', 'tr']),
    new Print(L + 450, 180, s, s, 0.025, 12, 14, ['tl', 'br']),
    new Print(L + 24, 740, s, s, 0.02, 13, 14, ['tr', 'bl']),
    new Print(L + 446, 780, s, s, -0.035, 14, 14, ['tl', 'br']),
  ];
  p.compose = (p) => {
    const g = p.g;
    header(g, 'Experience');
    prints.forEach((pr, i) => {
      pr.back(g);
      pr.picture(g, pics[i].img);
      pr.tapes(g);
      const b = pr.below;
      caption(g, `fig. ${i + 1}  ${caps[i][0]}`, b.x, b.y, 22, INK);
      para(g, caps[i][1], b.x, b.y + 6, s + 10, { size: 21, lh: 29, italic: true, color: INK2 });
    });
  };
  p.rebuild();
  return p;
}

function tourismPage(n: number) {
  const c = content.tourism;
  let diagram: ReturnType<typeof tourismModel> | null = null;
  return composed(n, (p) => {
    const g = p.g;
    header(g, 'Projects');
    let y = title(g, c.name, 118);
    y = meta(g, `${c.when} · ${c.stack} · team of three`, y);
    y = para(g, c.text, L, y + 6, W, { size: 26, lh: 37 }) + 12;
    y = para(g, c.result, L, y, W, { size: 26, lh: 37, italic: true, color: INK2 }) + 26;
    diagram = tourismModel(L, y, W);
    p.liveRects = [pixelRect(diagram.area.x, diagram.area.y, diagram.area.w, diagram.area.h)];
    diagram.still(g);
    y += diagram.height + 14;
    link(p, short(c.repo) + ' →', { href: c.repo }, L, y, 22);
  }, (g, t) => diagram?.live(g, t));
}

/** how far past a print's picture its tape can reach (px) */
const TAPE_REACH = 76;

/** A print that shows a looping video: paper and tape are part of the page, the picture moves. */
function videoPrint(pr: Print, v: Clip, trim = 0) {
  return {
    /** where `live` draws: the picture and the tape over its corners */
    get area() { const b = pr.bounds(TAPE_REACH); return pixelRect(b.x, b.y, b.w, b.h); },
    still(g: G) { pr.back(g); },
    live(g: G) {
      if (v.ready) pr.picture(g, v.video, v.video.videoWidth, v.video.videoHeight, trim);
      pr.tapes(g);
    },
  };
}

function teguPage(n: number) {
  const c = content.tegu;
  const p = new Page(STYLE, n);
  const clips = [clip('tegu-seed1.mp4', p), clip('tegu-seed2.mp4', p)];
  // (the recordings carry a GIF-maker's mark along the bottom; the prints leave it off)
  const w = 372, h = Math.round(w * 478 / 372);
  const prints = [new Print(L + 8, 0, w, h, -0.025, 21, 14, ['tl', 'tr']), new Print(L + 448, 0, w, h, 0.03, 22, 14, ['tl', 'br'])];
  const vids = prints.map((pr, i) => videoPrint(pr, clips[i], 22));
  p.compose = (p) => {
    const g = p.g;
    header(g, 'Projects');
    let y = title(g, c.name, 118);
    y = meta(g, `${c.when} · ${c.stack}`, y);
    y = para(g, c.text, L, y + 6, W, { size: 28, lh: 41 }) + 44;
    prints[0].y = y;
    prints[1].y = y + 26;
    vids.forEach((v) => v.still(g));
    p.liveRects = vids.map((v) => v.area);
    caption(g, 'seed 1 · 100 steps', prints[0].below.x, prints[0].below.y, 22, INK);
    caption(g, 'seed 2 · 100 steps', prints[1].below.x, prints[1].below.y, 22, INK);
    y = prints[1].below.y + 22;
    para(g, 'red: good habitat · blue: poor · green: tegus', L, y, W, { font: typeFont(20), size: 20, lh: 28, color: INK3 });
    y = para(g, c.finding, L, y + 46, W, { size: 27, lh: 39, italic: true, color: INK2 }) + 20;
    link(p, short(c.repo) + ' →', { href: c.repo }, L, y, 22);
  };
  p.live = (g) => vids.forEach((v) => v.live(g));
  p.frames = newFrames(clips);
  p.rebuild();
  return p;
}

function reptilePage(n: number) {
  const c = content.reptile;
  const p = new Page(STYLE, n);
  const demo = clip('reptile-demo.mp4', p);
  const w = 700, h = Math.round(w * 674 / 960);
  const pr = new Print(L + 60, 0, w, h, -0.015, 31, 14, ['tl', 'br']);
  const vid = videoPrint(pr, demo);
  p.compose = (p) => {
    const g = p.g;
    header(g, 'Projects');
    let y = title(g, c.name, 118);
    y = meta(g, `${c.stack} · team of three`, y);
    pr.y = y + 30;
    vid.still(g);
    p.liveRects = [vid.area];
    caption(g, 'Reptibot: a care question, then a data one with its SQL', pr.below.x, pr.below.y - 4, 21);
    y = pr.below.y + 30;
    y = para(g, c.text, L, y, W, { size: 26, lh: 37 }) + 10;
    y = para(g, c.ai, L, y, W, { size: 26, lh: 37 }) + 10;
    y = para(g, c.ci, L, y, W, { size: 24, lh: 35, italic: true, color: INK2 }) + 12;
    const y2 = link(p, short(c.repo) + ' →', { href: c.repo }, L, y, 22);
    link(p, 'try it live →', { href: c.demo }, L, y2 - 8, 22);
  };
  p.live = (g) => vid.live(g);
  p.frames = newFrames([demo]);
  p.rebuild();
  return p;
}

type Experiment = (typeof content.numerical)[number];

/**
 * A page of Numerical Experiments: two, one above the other, each a square print on one side and a short
 * note on the other (alternating sides down the page). The first page carries the section's title.
 */
function numericalPage(n: number, pair: Experiment[], first: boolean) {
  const p = new Page(STYLE, n);
  const s = first ? 400 : 430;                         // print size
  const top = first ? 300 : 128;                       // where the two halves start
  const half = (1310 - top) / 2;
  const items = pair.map((e, k) => {
    const printLeft = (k + (first ? 0 : 1)) % 2 === 0;
    const y = top + k * half + (half - s) / 2;
    const pr = new Print(printLeft ? L + 14 : R - s - 14, y, s, s, (k % 2 ? 1 : -1) * 0.022, 50 + n * 2 + k, 14,
      printLeft ? ['tl', 'bl'] : ['tr', 'br']); // (taped on the side away from the note)
    const still = picture(e.poster ?? e.image!, p);
    const film = e.video ? clip(e.video, p) : null;
    return { e, pr, still, film, printLeft, y };
  });
  p.compose = (p) => {
    const g = p.g;
    header(g, 'Projects');
    p.liveRects = items.filter((it) => it.film).map(({ pr }) => { const b = pr.bounds(TAPE_REACH); return pixelRect(b.x, b.y, b.w, b.h); });
    if (first) {
      const y = title(g, 'Numerical Experiments', 118);
      para(g, content.numericalIntro, L, y + 4, W, { size: 27, lh: 39, italic: true, color: INK2 });
    }
    items.forEach(({ e, pr, still, film, printLeft }, k) => {
      pr.back(g);
      pr.picture(g, still.img);
      if (!film) pr.tapes(g);
      // the note beside the print, centred on it
      const colW = W - s - 64;
      const x = printLeft ? R - colW : L;
      const block = 38 * 2 + 30 + 35 * 6 + 40;
      let y = pr.y + (s - block) / 2;
      y = para(g, e.name, x, y, colW, { font: typeFont(30), size: 30, lh: 38 }) + 4;
      label(g, `${e.lang} · 2025`.toUpperCase(), x, y + 12, typeFont(19), INK3, colW, 'left');
      y += 38;
      y = para(g, e.text, x, y, colW, { size: 23, lh: 34 }) + 10;
      link(p, 'code on GitHub →', { href: e.repo }, x, y, 20);
      // a quiet rule between the two
      if (k === 0) penLine(g, L + 120, top + half, R - 120, top + half, 60 + n, 1.4, INK3);
    });
  };
  const films = items.flatMap((it) => (it.film ? [it.film] : []));
  if (films.length) p.frames = newFrames(films);
  p.live = (g) => {
    for (const { pr, film } of items) {
      if (!film) continue;
      if (film.ready) pr.picture(g, film.video, film.video.videoWidth, film.video.videoHeight);
      pr.tapes(g);
    }
  };
  p.rebuild();
  return p;
}

function contactPage(n: number) {
  return composed(n, (p) => {
    const g = p.g;
    header(g, 'Contact');
    let y = title(g, 'Contact', 128, 46) + 20;
    y = para(g, 'Email is the quickest way to reach me.', L, y, W, { size: 31, lh: 46 }) + 60;
    // a calling card, taped in square so its links sit where they're drawn
    const cw = 700, ch = 380, cx = L + (W - cw) / 2, cy = y;
    g.save();
    g.shadowColor = 'rgba(40,25,10,0.3)';
    g.shadowBlur = 16;
    g.shadowOffsetX = 3;
    g.shadowOffsetY = 7;
    g.fillStyle = '#fbf8f1';
    g.fillRect(cx, cy, cw, ch);
    g.restore();
    label(g, content.fullName.toUpperCase(), cx + cw / 2, cy + 90, typeFont(44), INK, cw - 60);
    penLine(g, cx + cw / 2 - 90, cy + 132, cx + cw / 2 + 90, cy + 132, 8, 2, RED);
    g.save();
    g.font = typeFont(30);
    const ew = g.measureText(content.email).width;
    const gw = g.measureText(short(content.github)).width;
    g.restore();
    link(p, content.email, { href: 'mailto:' + content.email }, cx + (cw - ew) / 2, cy + 180, 30);
    link(p, short(content.github), { href: content.github }, cx + (cw - gw) / 2, cy + 252, 30);
    tape(g, cx + 30, cy + 4, 130, 36, -0.62, 81);
    tape(g, cx + cw - 30, cy + 4, 130, 36, 0.62, 82);
    y = cy + ch + 110;
    penLine(g, L, y, L + 160, y, 9, 2, RED);
    para(g, 'This book is lying on the floor of Puget Sound, about thirty feet down. Everything moving around it is simulated; click an animal in the water to log it in the field notebook.',
      L, y + 30, W, { size: 26, lh: 39, italic: true, color: INK2 });
  });
}

// ------------------------------------------------------------------ the book

/**
 * The red portfolio book: the contents pasted inside the front cover, then a section to a page or a
 * spread. Also returns where each section starts, for the quick-jump card beside the book.
 */
export function portfolioPages(): { pages: Page[]; inside: Page; sections: Section[] } {
  const pages: Page[] = [];
  const sections: Section[] = [{ id: 'contents', label: 'Contents', page: -1 }];
  const add = (make: (n: number) => Page) => { const i = pages.length; pages.push(make(i + 1)); return i; };
  const section = (id: string, label: string, page: number) => sections.push({ id, label, page });
  /** the next page is a left-hand one (odd index), so a two-page section lands on one spread */
  const toLeft = () => { if (pages.length % 2 === 0) add((n) => new Page(STYLE, n)); };

  section('about', 'About', add(aboutPage));
  toLeft();
  section('cascadia', 'Cascadia Research', add(cascadiaLeft));
  add(cascadiaRight);
  section('wwu', 'Western Washington U.', add(wwuLeft));
  add(wwuRight);
  section('tourism', 'Tourism tax model', add(tourismPage));
  section('tegu', 'Tegu simulation', add(teguPage));
  section('reptile', 'Reptile Central', add(reptilePage));
  if (content.numerical.length) {
    const first = pages.length;
    for (let k = 0; k < content.numerical.length; k += 2) {
      add((n) => numericalPage(n, content.numerical.slice(k, k + 2), k === 0));
    }
    section('numerical', 'Numerical experiments', first);
  }
  section('contact', 'Contact', add(contactPage));

  // credits flow onto as many pages as they need
  const blocks: Block[] = [];
  blocks.push({ kind: 'heading', text: 'Credits' });
  blocks.push({ kind: 'para', small: true, text: CC0_NOTE + ' These models are used under the licences noted, each cleaned up and re-baked for this scene:' });
  for (const c of CREDITS) blocks.push({ kind: 'link', small: true, text: `${c.title} — ${c.author} (${c.license})`, href: c.url });
  section('credits', 'Credits', pages.length);
  let k = pages.length;
  pages.push(...flow(blocks, () => new Page({ ...STYLE, header: 'Credits' }, ++k)));

  const entries: { label: string; page: number; indent?: boolean; group?: boolean }[] = [];
  const at = (id: string) => sections.find((s) => s.id === id)!.page;
  entries.push({ label: 'About', page: at('about') });
  entries.push({ label: 'Experience', page: at('cascadia'), group: true });
  entries.push({ label: 'Cascadia Research Collective', page: at('cascadia'), indent: true });
  entries.push({ label: 'Western Washington University', page: at('wwu'), indent: true });
  entries.push({ label: 'Projects', page: at('tourism'), group: true });
  entries.push({ label: 'Tourism Tax Optimization', page: at('tourism'), indent: true });
  entries.push({ label: 'Invasive Tegu Simulation', page: at('tegu'), indent: true });
  entries.push({ label: 'Reptile Central Database', page: at('reptile'), indent: true });
  if (content.numerical.length) entries.push({ label: 'Numerical Experiments', page: at('numerical'), indent: true });
  entries.push({ label: 'Contact', page: at('contact') });
  entries.push({ label: 'Credits', page: at('credits') });
  const inside = contentsPage(entries);
  return { pages, inside, sections };
}
