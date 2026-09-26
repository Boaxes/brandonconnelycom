import { content } from '../content';
import { CC0_NOTE, CREDITS } from '../credits';
import { flow, Page, TYPE, SERIF, PAGE_W, PAGE_H, type Block, type PageStyle } from './Page';

const STYLE: PageStyle = {
  paper: '#f1e9d6',
  ink: '#2a2622',
  ink2: '#5a544b',
  ink3: '#8c8475',
  accent: '#7d2a22',
};

export interface Section { id: string; label: string; tab: string; page: number }

/**
 * The red portfolio book: a title page, a contents page, then the portfolio flowed across as many pages
 * as it needs. Returns the pages and where each section starts (for the contents page and the tabs).
 */
export function portfolioPages(): { pages: Page[]; sections: Section[] } {
  const pages: Page[] = [];
  let n = 1; // the contents page is page 1
  const make = (header = true) => new Page({ ...STYLE, header: header ? content.fullName + ' · ' + content.title : undefined }, ++n);

  // title page (right-hand page of the first spread)
  const t = new Page(STYLE);
  const g = t.g;
  g.textAlign = 'center';
  g.fillStyle = STYLE.ink3;
  g.font = `26px ${TYPE}`;
  g.fillText('PORTFOLIO', PAGE_W / 2, 360);
  g.fillStyle = STYLE.ink;
  g.font = `70px ${TYPE}`;
  g.fillText(content.fullName.toUpperCase(), PAGE_W / 2, 470);
  g.strokeStyle = STYLE.accent;
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(PAGE_W / 2 - 90, 520); g.lineTo(PAGE_W / 2 + 90, 520); g.stroke();
  g.font = `34px ${TYPE}`;
  g.fillStyle = STYLE.ink2;
  g.fillText(`${content.title} · ${content.location}`, PAGE_W / 2, 590);
  g.font = `italic 34px ${SERIF}`;
  g.fillStyle = STYLE.ink;
  t.y = 680;
  g.textAlign = 'left';
  const lines = t.wrap(content.tagline, 700);
  g.textAlign = 'center';
  lines.forEach((l, i) => g.fillText(l, PAGE_W / 2, 700 + i * 52));
  g.font = `24px ${TYPE}`;
  g.fillStyle = STYLE.ink3;
  g.fillText('click the right-hand page to turn · left to go back', PAGE_W / 2, PAGE_H - 170);
  g.fillText('the tabs on the edge jump to a section · scroll to zoom', PAGE_W / 2, PAGE_H - 132);
  g.textAlign = 'left';
  pages.push(t);
  // contents: drawn once the flow below has decided where each section starts
  const contents = new Page({ ...STYLE, header: content.fullName + ' · ' + content.title }, 1);
  pages.push(contents);

  const blocks: Block[] = [];
  blocks.push({ kind: 'heading', text: 'About', id: 'about' });
  for (const p of content.about) blocks.push({ kind: 'para', text: p });
  blocks.push({ kind: 'break' });

  blocks.push({ kind: 'heading', text: 'Selected work', id: 'work' });
  content.projects.forEach((p, i) => {
    if (i) blocks.push({ kind: 'rule' });
    blocks.push({ kind: 'sub', text: p.name });
    blocks.push({ kind: 'meta', text: p.meta });
    blocks.push({ kind: 'para', text: p.blurb });
    blocks.push({ kind: 'meta', text: p.tags.join(' · ') });
    if (p.link && p.link !== '#') blocks.push({ kind: 'link', text: 'read more →', href: p.link });
  });
  blocks.push({ kind: 'break' });

  blocks.push({ kind: 'heading', text: 'Experience', id: 'experience' });
  content.experience.forEach((e, i) => {
    if (i) blocks.push({ kind: 'space', h: 16 });
    blocks.push({ kind: 'sub', text: `${e.role}, ${e.org}` });
    blocks.push({ kind: 'meta', text: e.when });
    blocks.push({ kind: 'para', text: e.blurb });
  });
  blocks.push({ kind: 'break' });

  blocks.push({ kind: 'heading', text: 'Toolkit', id: 'toolkit' });
  for (const [k, v] of Object.entries(content.skills)) {
    blocks.push({ kind: 'meta', text: k.toUpperCase() });
    blocks.push({ kind: 'para', text: v.join(', ') });
  }
  blocks.push({ kind: 'break' });

  blocks.push({ kind: 'heading', text: 'Say hello', id: 'contact' });
  blocks.push({ kind: 'para', text: 'Email is fastest. I read everything.' });
  blocks.push({ kind: 'link', text: content.email, href: 'mailto:' + content.email });
  blocks.push({ kind: 'link', text: 'GitHub', href: content.links.github });
  blocks.push({ kind: 'link', text: 'LinkedIn', href: content.links.linkedin });
  blocks.push({ kind: 'link', text: 'Résumé (PDF)', href: content.links.resume });
  blocks.push({ kind: 'space', h: 30 });
  blocks.push({ kind: 'para', small: true, italic: true, text: 'This book is sitting on the floor of Puget Sound, about thirty feet down. Everything moving around it is simulated; click an animal in the water to log it in the field notebook.' });
  blocks.push({ kind: 'break' });

  blocks.push({ kind: 'heading', text: 'Credits', id: 'credits' });
  blocks.push({ kind: 'para', small: true, text: CC0_NOTE + ' These models are used under the licences noted, each cleaned up and re-baked for this scene:' });
  for (const c of CREDITS) blocks.push({ kind: 'link', small: true, text: `${c.title} — ${c.author} (${c.license})`, href: c.url });

  const anchors: Record<string, number> = {};
  const first = pages.length;
  pages.push(...flow(blocks, () => make(), anchors));
  const sections: Section[] = [
    { id: 'about', label: 'About', tab: 'About', page: 0 },
    { id: 'work', label: 'Selected work', tab: 'Work', page: 0 },
    { id: 'experience', label: 'Experience', tab: 'Experience', page: 0 },
    { id: 'toolkit', label: 'Toolkit', tab: 'Toolkit', page: 0 },
    { id: 'contact', label: 'Say hello', tab: 'Contact', page: 0 },
    { id: 'credits', label: 'Credits', tab: 'Credits', page: 0 },
  ].filter((s) => anchors[s.id] !== undefined).map((s) => ({ ...s, page: first + anchors[s.id] }));
  drawContents(contents, sections);
  return { pages, sections: [{ id: 'contents', label: 'Contents', tab: 'Contents', page: 1 }, ...sections] };
}

/** The contents page: each line turns straight to its section. */
function drawContents(p: Page, sections: Section[]) {
  const g = p.g;
  p.y = 170;
  p.text('Contents', `52px ${TYPE}`, STYLE.ink, p.left, 76);
  p.y += 40;
  for (const s of sections) {
    const y0 = p.y;
    g.font = `36px ${TYPE}`;
    const label = s.label;
    const num = String(s.page);
    const lw = g.measureText(label).width;
    const nw = g.measureText(num).width;
    p.text(label, `36px ${TYPE}`, STYLE.ink, p.left, 86);
    g.fillStyle = STYLE.ink;
    g.fillText(num, p.right - nw, y0 + 86 * 0.72);
    // dotted leader between the title and the page number
    g.fillStyle = STYLE.ink3;
    for (let x = p.left + lw + 24; x < p.right - nw - 20; x += 18) g.fillRect(x, y0 + 86 * 0.72 - 4, 3, 3);
    p.hit(p.left - 16, y0 + 6, p.right - p.left + 32, 76, { page: s.page });
  }
  p.y += 40;
  g.font = `italic 28px ${SERIF}`;
  g.fillStyle = STYLE.ink2;
  for (const l of p.wrap('Click a line to turn straight there, or use the tabs on the edge of the book at any time.')) {
    g.fillText(l, p.left, p.y + 30);
    p.y += 42;
  }
  p.version++;
}
