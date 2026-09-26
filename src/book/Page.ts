/**
 * Typesetting for the 3D books: each page is a canvas that becomes a texture. A tiny flow layout
 * (headings, paragraphs, lists, links, rules) fills pages top to bottom and breaks onto the next one,
 * recording clickable rectangles so a click on the 3D page can be mapped back to a link.
 */
export const PAGE_W = 1024;
export const PAGE_H = 1434;

export const SERIF = "'Lora', Georgia, serif";
export const TYPE = "'Special Elite', 'Courier New', monospace";

export interface Hit {
  /** normalised page rect (0..1, origin top-left) */
  x: number; y: number; w: number; h: number;
  href?: string;
  /** internal jump: page index */
  page?: number;
}

export interface PageStyle {
  paper: string;
  ink: string;
  ink2: string;
  ink3: string;
  accent: string;
  ruled?: boolean;
  margin?: number;   // left margin (px)
  header?: string;
}

let _grain: HTMLCanvasElement | null = null;
function grain() {
  if (_grain) return _grain;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 200 + Math.random() * 55;
    img.data[i] = v; img.data[i + 1] = v * 0.97; img.data[i + 2] = v * 0.9; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return (_grain = c);
}

export class Page {
  canvas = document.createElement('canvas');
  g: CanvasRenderingContext2D;
  hits: Hit[] = [];
  y: number;
  readonly left: number;
  readonly right = PAGE_W - 84;
  readonly bottom = PAGE_H - 120;
  /** set when the page content changes, so the texture re-uploads */
  version = 0;

  constructor(public style: PageStyle, public number?: number) {
    this.canvas.width = PAGE_W;
    this.canvas.height = PAGE_H;
    this.g = this.canvas.getContext('2d')!;
    this.left = style.margin ?? 100;
    this.y = 128;
    this.clear();
  }

  get width() { return this.right - this.left; }
  space(h: number) { return this.y + h <= this.bottom; }

  clear() {
    const g = this.g;
    const s = this.style;
    this.hits = [];
    this.y = 128;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = s.paper;
    g.fillRect(0, 0, PAGE_W, PAGE_H);
    g.globalCompositeOperation = 'multiply';
    g.globalAlpha = 0.35;
    g.fillStyle = g.createPattern(grain(), 'repeat')!;
    g.fillRect(0, 0, PAGE_W, PAGE_H);
    g.globalAlpha = 1;
    // a soft darkening toward the edges, and toward the spine
    const v = g.createRadialGradient(PAGE_W / 2, PAGE_H / 2, PAGE_H * 0.35, PAGE_W / 2, PAGE_H / 2, PAGE_H * 0.8);
    v.addColorStop(0, 'rgba(255,255,255,1)');
    v.addColorStop(1, 'rgba(215,200,170,1)');
    g.fillStyle = v;
    g.fillRect(0, 0, PAGE_W, PAGE_H);
    g.globalCompositeOperation = 'source-over';
    if (s.ruled) {
      g.strokeStyle = 'rgba(60,50,30,0.13)';
      g.lineWidth = 2;
      for (let yy = 150; yy < PAGE_H - 60; yy += 52) {
        g.beginPath(); g.moveTo(0, yy); g.lineTo(PAGE_W, yy); g.stroke();
      }
      g.strokeStyle = 'rgba(178,60,50,0.45)';
      g.beginPath(); g.moveTo(this.left - 24, 0); g.lineTo(this.left - 24, PAGE_H); g.stroke();
    }
    if (s.header) {
      g.font = `24px ${TYPE}`;
      g.fillStyle = s.ink3;
      g.textBaseline = 'alphabetic';
      g.fillText(s.header.toUpperCase(), this.left, 76);
    }
    if (this.number !== undefined) {
      g.font = `26px ${TYPE}`;
      g.fillStyle = s.ink3;
      g.textAlign = 'center';
      g.fillText(String(this.number), PAGE_W / 2, PAGE_H - 58);
      g.textAlign = 'left';
    }
    this.version++;
  }

  /** Wrap text into lines that fit `width` in the current font. */
  wrap(text: string, width = this.width): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (this.g.measureText(t).width > width && line) {
        lines.push(line);
        line = w;
      } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  text(str: string, font: string, color: string, x = this.left, lineH = 50) {
    const g = this.g;
    g.font = font;
    g.fillStyle = color;
    g.textBaseline = 'alphabetic';
    g.fillText(str, x, this.y + lineH * 0.72);
    this.y += lineH;
    this.version++;
  }

  hit(x: number, y: number, w: number, h: number, target: { href?: string; page?: number }) {
    this.hits.push({ x: x / PAGE_W, y: y / PAGE_H, w: w / PAGE_W, h: h / PAGE_H, ...target });
  }

  hitAt(u: number, v: number): Hit | null {
    // u,v with origin top-left
    for (const h of this.hits) if (u >= h.x && u <= h.x + h.w && v >= h.y && v <= h.y + h.h) return h;
    return null;
  }
}

// ------------------------------------------------------------------ flow layout

export type Block =
  | { kind: 'title'; text: string; size?: number }
  | { kind: 'heading'; text: string; id?: string }
  | { kind: 'sub'; text: string }
  | { kind: 'meta'; text: string }
  | { kind: 'para'; text: string; italic?: boolean; small?: boolean }
  | { kind: 'list'; items: string[] }
  | { kind: 'link'; text: string; href?: string; page?: number; small?: boolean }
  | { kind: 'rule' }
  | { kind: 'space'; h: number }
  | { kind: 'break' };

/**
 * Lay blocks out across as many pages as needed. `make` creates a fresh page. Headings with an `id`
 * record the index (within the returned pages) of the page they landed on in `anchors`.
 */
export function flow(blocks: Block[], make: () => Page, anchors: Record<string, number> = {}): Page[] {
  const pages: Page[] = [make()];
  let p = pages[0];
  const next = () => { p = make(); pages.push(p); };
  const s = () => p.style;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    switch (b.kind) {
      case 'break':
        if (p.y > 140) next();
        break;
      case 'space':
        p.y += b.h;
        break;
      case 'rule':
        if (!p.space(40)) { next(); break; }
        p.g.strokeStyle = 'rgba(60,50,30,0.35)';
        p.g.setLineDash([8, 8]);
        p.g.lineWidth = 2;
        p.g.beginPath(); p.g.moveTo(p.left, p.y + 20); p.g.lineTo(p.right, p.y + 20); p.g.stroke();
        p.g.setLineDash([]);
        p.y += 40;
        break;
      case 'title': {
        const size = b.size ?? 64;
        p.g.font = `${size}px ${TYPE}`;
        for (const l of p.wrap(b.text)) p.text(l, `${size}px ${TYPE}`, s().ink, p.left, size * 1.2);
        break;
      }
      case 'heading': {
        // keep a heading with at least a few lines of what follows
        if (!p.space(64 + 150)) next();
        if (b.id) anchors[b.id] = pages.length - 1;
        p.y += 10;
        p.g.font = `46px ${TYPE}`;
        for (const l of p.wrap(b.text)) p.text(l, `46px ${TYPE}`, s().ink, p.left, 62);
        p.y += 8;
        break;
      }
      case 'sub': {
        if (!p.space(52 + 100)) next();
        p.g.font = `36px ${TYPE}`;
        for (const l of p.wrap(b.text)) p.text(l, `36px ${TYPE}`, s().ink, p.left, 50);
        break;
      }
      case 'meta': {
        p.g.font = `26px ${TYPE}`;
        for (const l of p.wrap(b.text)) {
          if (!p.space(38)) next();
          p.text(l, `26px ${TYPE}`, s().ink3, p.left, 38);
        }
        p.y += 4;
        break;
      }
      case 'para': {
        const size = b.small ? 28 : 33;
        const lh = b.small ? 42 : 50;
        const font = `${b.italic ? 'italic ' : ''}${size}px ${SERIF}`;
        p.g.font = font;
        const lines = p.wrap(b.text);
        for (const l of lines) {
          if (!p.space(lh)) { next(); p.g.font = font; }
          p.text(l, font, b.small ? s().ink2 : s().ink, p.left, lh);
        }
        p.y += 14;
        break;
      }
      case 'list': {
        const font = `31px ${SERIF}`;
        for (const it of b.items) {
          p.g.font = font;
          const lines = p.wrap(it, p.width - 34);
          lines.forEach((l, k) => {
            if (!p.space(46)) { next(); p.g.font = font; }
            if (k === 0) { p.g.fillStyle = s().ink3; p.g.fillText('–', p.left, p.y + 33); }
            p.text(l, font, s().ink, p.left + 34, 46);
          });
        }
        p.y += 10;
        break;
      }
      case 'link': {
        const lh = b.small ? 40 : 50;
        if (!p.space(lh)) next();
        const font = `${b.small ? 23 : 31}px ${TYPE}`;
        p.g.font = font;
        let text = b.text;
        while (p.g.measureText(text).width > p.width && text.length > 4) text = text.slice(0, -2) + '…';
        const w = p.g.measureText(text).width;
        const y0 = p.y;
        p.text(text, font, s().accent, p.left, lh);
        p.g.strokeStyle = s().accent;
        p.g.lineWidth = 1.5;
        p.g.beginPath(); p.g.moveTo(p.left, y0 + lh * 0.84); p.g.lineTo(p.left + w, y0 + lh * 0.84); p.g.stroke();
        p.hit(p.left - 10, y0, w + 20, lh, { href: b.href, page: b.page });
        break;
      }
    }
  }
  return pages;
}
