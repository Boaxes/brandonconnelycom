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

export interface Rect { x: number; y: number; w: number; h: number }

/** The smallest whole-pixel rect on the page holding (x, y, w, h). */
export function pixelRect(x: number, y: number, w: number, h: number): Rect {
  const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(PAGE_W, Math.ceil(x + w)), y1 = Math.min(PAGE_H, Math.ceil(y + h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
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

/**
 * WebKit: Safari, and every browser on an iPhone or iPad (they all have to use it). The pages go to the GPU
 * differently there; see CANVAS_OPTIONS and Book3D.patch.
 */
const ua = navigator.userAgent;
export const WEBKIT = /iPhone|iPad|iPod/.test(ua) || (/AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua))
  || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)); // (iPadOS asks for desktop sites as a Mac)

/**
 * In WebKit, page canvases are kept in main memory (`willReadFrequently`): a GPU-backed canvas lives in the
 * browser's GPU process, and copying one into a WebGL texture waits on that process, which made an animated
 * spread take 15-35 ms a frame there. In Chrome it's the other way round (its GPU canvases copy to WebGL
 * without leaving the GPU), so they stay as they are.
 */
export const CANVAS_OPTIONS: CanvasRenderingContext2DSettings = WEBKIT ? { willReadFrequently: true } : {};

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
  /**
   * set when anything other than the moving parts changes: until it does, only `liveRects` need
   * re-uploading when the page animates
   */
  fullVersion = 0;
  /**
   * Where the moving parts draw (page px, whole pixels). Each tick puts the still page back and redraws
   * only inside these, and only these go to the GPU; empty means the whole page.
   */
  liveRects: Rect[] = [];
  /** the rect round all of `liveRects` */
  get liveBounds(): Rect {
    const r = this.liveRects;
    const x = Math.min(...r.map((a) => a.x)), y = Math.min(...r.map((a) => a.y));
    return { x, y, w: Math.max(...r.map((a) => a.x + a.w)) - x, h: Math.max(...r.map((a) => a.y + a.h)) - y };
  }
  /** Hand-composed pages: draws the whole page (again whenever one of its pictures arrives). */
  compose: ((p: Page) => void) | null = null;
  /** Moving parts, drawn over the composed page every frame while it's in view. */
  live: ((g: CanvasRenderingContext2D, t: number) => void) | null = null;
  /** told when the page comes into or goes out of view (to start and stop its videos) */
  onShow: ((shown: boolean) => void) | null = null;
  /**
   * For moving parts that only change now and then (screen recordings): whether one has a new frame since
   * the page was last drawn. Without it the page redraws at every tick.
   */
  frames: { changed(): boolean; taken(): void } | null = null;
  /** when (on the caller's clock) the moving parts were last drawn */
  drawnAt = -Infinity;
  shown = false;
  /** when (on the caller's clock) the page last came into view: its moving parts start from there */
  private shownAt = 0;
  /** just came into view: its first moment is drawn whether or not anything reports a change */
  private fresh = false;
  private base: HTMLCanvasElement | null = null;

  constructor(public style: PageStyle, public number?: number) {
    this.canvas.width = PAGE_W;
    this.canvas.height = PAGE_H;
    this.g = this.canvas.getContext('2d', CANVAS_OPTIONS)!;
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
    this.fullVersion++;
  }

  /** Redraw a composed page from scratch (its moving parts go back on top at the next tick). */
  rebuild() {
    this.clear();
    this.compose?.(this);
    this.base = null;
    this.version++;
    this.fullVersion++;
  }

  /**
   * Draw the moving parts as they are at `now` (the caller's clock), timed from when the page last came
   * into view, so they start from the beginning each time it's opened. The still page is kept aside and put
   * back under them each time. False when there was nothing to draw.
   */
  tick(now: number) {
    const live = this.live;
    if (!live || !this.due) return false;
    this.fresh = false;
    this.frames?.taken();
    this.drawnAt = now;
    const t = now - this.shownAt;
    if (!this.base) {
      this.base = document.createElement('canvas');
      this.base.width = PAGE_W;
      this.base.height = PAGE_H;
      this.base.getContext('2d', CANVAS_OPTIONS)!.drawImage(this.canvas, 0, 0);
    }
    const g = this.g;
    const rects = this.liveRects;
    if (!rects.length) {
      g.drawImage(this.base, 0, 0);
      live(g, t);
    } else {
      g.save();
      g.beginPath();
      for (const r of rects) {
        g.drawImage(this.base, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
        g.rect(r.x, r.y, r.w, r.h);
      }
      g.clip();
      live(g, t);
      g.restore();
    }
    this.version++;
    return true;
  }

  /** whether a tick now would draw anything */
  get due() { return !!this.live && (this.fresh || !this.frames || this.frames.changed()); }

  setShown(shown: boolean, now = 0) {
    if (shown === this.shown) return;
    this.shown = shown;
    if (shown) {
      this.shownAt = now;
      this.fresh = true;
    }
    this.onShow?.(shown);
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
    this.fullVersion++;
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
