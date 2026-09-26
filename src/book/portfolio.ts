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

/** The red portfolio book: a title page, then the portfolio flowed across as many pages as it needs. */
export function portfolioPages(): Page[] {
  const pages: Page[] = [];
  let n = 0;
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
  g.fillText('← →  keys work too · scroll to look closer', PAGE_W / 2, PAGE_H - 132);
  g.textAlign = 'left';
  pages.push(t);

  const blocks: Block[] = [];
  blocks.push({ kind: 'heading', text: 'About' });
  for (const p of content.about) blocks.push({ kind: 'para', text: p });
  blocks.push({ kind: 'break' });

  blocks.push({ kind: 'heading', text: 'Selected work' });
  content.projects.forEach((p, i) => {
    if (i) blocks.push({ kind: 'rule' });
    blocks.push({ kind: 'sub', text: p.name });
    blocks.push({ kind: 'meta', text: p.meta });
    blocks.push({ kind: 'para', text: p.blurb });
    blocks.push({ kind: 'meta', text: p.tags.join(' · ') });
    if (p.link && p.link !== '#') blocks.push({ kind: 'link', text: 'read more →', href: p.link });
  });
  blocks.push({ kind: 'break' });

  blocks.push({ kind: 'heading', text: 'Experience' });
  content.experience.forEach((e, i) => {
    if (i) blocks.push({ kind: 'space', h: 16 });
    blocks.push({ kind: 'sub', text: `${e.role}, ${e.org}` });
    blocks.push({ kind: 'meta', text: e.when });
    blocks.push({ kind: 'para', text: e.blurb });
  });
  blocks.push({ kind: 'break' });

  blocks.push({ kind: 'heading', text: 'Toolkit' });
  for (const [k, v] of Object.entries(content.skills)) {
    blocks.push({ kind: 'meta', text: k.toUpperCase() });
    blocks.push({ kind: 'para', text: v.join(', ') });
  }
  blocks.push({ kind: 'break' });

  blocks.push({ kind: 'heading', text: 'Say hello' });
  blocks.push({ kind: 'para', text: 'Email is fastest. I read everything.' });
  blocks.push({ kind: 'link', text: content.email, href: 'mailto:' + content.email });
  blocks.push({ kind: 'link', text: 'GitHub', href: content.links.github });
  blocks.push({ kind: 'link', text: 'LinkedIn', href: content.links.linkedin });
  blocks.push({ kind: 'link', text: 'Résumé (PDF)', href: content.links.resume });
  blocks.push({ kind: 'space', h: 30 });
  blocks.push({ kind: 'para', small: true, italic: true, text: 'This book is sitting on the floor of Puget Sound, about thirty feet down. Everything moving around it is simulated; click an animal in the water to log it in the field notebook.' });
  blocks.push({ kind: 'break' });

  blocks.push({ kind: 'heading', text: 'Credits' });
  blocks.push({ kind: 'para', small: true, text: CC0_NOTE + ' These models are used under the licences noted, each cleaned up and re-baked for this scene:' });
  for (const c of CREDITS) blocks.push({ kind: 'link', small: true, text: `${c.title} — ${c.author} (${c.license})`, href: c.url });

  pages.push(...flow(blocks, () => make()));
  return pages;
}
