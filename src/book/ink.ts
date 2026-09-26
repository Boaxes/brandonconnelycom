/**
 * Pen-and-paper drawing for the portfolio pages: lines that wobble like a hand-held pen, index-card boxes,
 * arrows, masking tape, and prints taped onto the page. Everything is seeded, so a drawing comes out the
 * same every time it's redrawn (the pages are redrawn every frame while they animate).
 */
import { SERIF, TYPE } from './Page';

export const INK = '#2a2622';
export const INK2 = '#5a544b';
export const INK3 = '#8c8475';
export const RED = '#8d3b2f';
export const CARD = '#f8f2e2';

export type G = CanvasRenderingContext2D;

/** Small deterministic random numbers (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A pen line from a to b: a slight bow and tremor, overshooting its ends a hair. */
export function penLine(g: G, x0: number, y0: number, x1: number, y1: number, seed: number, width = 2.2, color = INK) {
  const r = rng(seed);
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const bow = (r() - 0.5) * Math.min(6, len * 0.02);
  const over = 2 + r() * 3;
  const ux = dx / len, uy = dy / len;
  const sx = x0 - ux * over * r(), sy = y0 - uy * over * r();
  const ex = x1 + ux * over * r(), ey = y1 + uy * over * r();
  const steps = Math.max(2, Math.round(len / 40));
  g.save();
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // two passes, the second fainter and a touch off, like ink that pooled unevenly
  for (let pass = 0; pass < 2; pass++) {
    g.globalAlpha = pass ? 0.35 : 0.9;
    g.lineWidth = pass ? width * 0.6 : width;
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const b = Math.sin(Math.PI * u) * bow + (r() - 0.5) * 0.9 + (pass ? 0.8 : 0);
      const x = sx + (ex - sx) * u + nx * b;
      const y = sy + (ey - sy) * u + ny * b;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.restore();
}

/** A pen polyline through points, with an arrowhead at the end (or both ends). */
export function penArrow(g: G, pts: [number, number][], seed: number, o: { color?: string; width?: number; dash?: boolean; both?: boolean; head?: boolean } = {}) {
  const color = o.color ?? INK;
  const width = o.width ?? 2;
  g.save();
  if (o.dash) g.setLineDash([9, 8]);
  for (let i = 0; i < pts.length - 1; i++) {
    if (o.dash) {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.globalAlpha = 0.8;
      g.beginPath(); g.moveTo(...pts[i]); g.lineTo(...pts[i + 1]); g.stroke();
    } else penLine(g, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], seed + i * 7, width, color);
  }
  g.restore();
  if (o.head !== false) arrowHead(g, pts[pts.length - 2], pts[pts.length - 1], seed + 99, color, width);
  if (o.both) arrowHead(g, pts[1], pts[0], seed + 98, color, width);
}

export function arrowHead(g: G, from: [number, number], to: [number, number], seed: number, color = INK, width = 2) {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const r = rng(seed);
  const s = 14;
  for (const side of [-1, 1]) {
    const b = a + Math.PI + side * (0.42 + (r() - 0.5) * 0.1);
    penLine(g, to[0], to[1], to[0] + Math.cos(b) * s, to[1] + Math.sin(b) * s, seed + side, width, color);
  }
}

/** A box ruled by hand; `fill` lays an index card down under it first. */
export function penBox(g: G, x: number, y: number, w: number, h: number, seed: number, o: { fill?: string; color?: string; width?: number; dash?: boolean } = {}) {
  if (o.fill) {
    g.save();
    g.fillStyle = 'rgba(60,40,20,0.10)';
    g.fillRect(x + 3, y + 4, w, h);
    g.fillStyle = o.fill;
    g.fillRect(x, y, w, h);
    g.restore();
  }
  const c = o.color ?? INK;
  const lw = o.width ?? 2.2;
  if (o.dash) {
    g.save();
    g.strokeStyle = c;
    g.globalAlpha = 0.7;
    g.lineWidth = 1.8;
    g.setLineDash([10, 9]);
    g.strokeRect(x, y, w, h);
    g.restore();
    return;
  }
  penLine(g, x, y, x + w, y, seed, lw, c);
  penLine(g, x + w, y, x + w, y + h, seed + 1, lw, c);
  penLine(g, x + w, y + h, x, y + h, seed + 2, lw, c);
  penLine(g, x, y + h, x, y, seed + 3, lw, c);
}

/** A strip of translucent masking tape, centred on (cx, cy), with torn ends. */
export function tape(g: G, cx: number, cy: number, w: number, h: number, angle: number, seed: number) {
  const r = rng(seed);
  g.save();
  g.translate(cx, cy);
  g.rotate(angle);
  g.beginPath();
  const teeth = 6;
  g.moveTo(-w / 2, -h / 2);
  g.lineTo(w / 2, -h / 2);
  for (let i = 1; i <= teeth; i++) g.lineTo(w / 2 + (r() - 0.5) * 7, -h / 2 + (h * i) / teeth);
  g.lineTo(-w / 2, h / 2);
  for (let i = teeth - 1; i >= 0; i--) g.lineTo(-w / 2 + (r() - 0.5) * 7, -h / 2 + (h * i) / teeth);
  g.closePath();
  g.fillStyle = 'rgba(236,222,184,0.72)';
  g.fill();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = 'rgba(200,180,130,0.18)';
  g.fill();
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(150,130,90,0.25)';
  g.lineWidth = 1;
  g.stroke();
  g.restore();
}

export type Img = CanvasImageSource & { width: number; height: number };

/**
 * A photo print taped to the page: white-bordered, turned a little, a soft shadow under it.
 * `back` draws the paper, `picture` the image (so a video can be redrawn on its own), `tapes` on top.
 */
export class Print {
  constructor(
    public x: number, public y: number, public w: number, public h: number,
    public angle = 0, public seed = 1, public border = 16,
    /** which corners get tape: tl, tr, br, bl */
    public corners: ('tl' | 'tr' | 'br' | 'bl')[] = ['tl', 'br'],
  ) {}

  private frame(g: G, f: () => void) {
    g.save();
    g.translate(this.x + this.w / 2, this.y + this.h / 2);
    g.rotate(this.angle);
    g.translate(-this.w / 2, -this.h / 2);
    f();
    g.restore();
  }

  back(g: G) {
    this.frame(g, () => {
      g.save();
      g.shadowColor = 'rgba(40,25,10,0.35)';
      g.shadowBlur = 14;
      g.shadowOffsetX = 3;
      g.shadowOffsetY = 6;
      g.fillStyle = '#fbf8f1';
      g.fillRect(-this.border, -this.border, this.w + 2 * this.border, this.h + 2 * this.border);
      g.restore();
      // an empty print shows grey until its picture arrives
      g.fillStyle = '#d9d3c4';
      g.fillRect(0, 0, this.w, this.h);
    });
  }

  /** Draw the image cover-fitted into the print (cropping whichever way it's too long). */
  picture(g: G, img: Img | null, sw = img?.width ?? 0, sh = img?.height ?? 0, trimBottom = 0) {
    if (!img || !sw || !sh) return;
    this.frame(g, () => {
      const th = sh - trimBottom;
      const s = Math.max(this.w / sw, this.h / th);
      const cw = this.w / s, ch = this.h / s;
      g.drawImage(img, (sw - cw) / 2, (th - ch) / 2, cw, ch, 0, 0, this.w, this.h);
      // photo paper sheen and a hairline where the print's emulsion ends
      g.strokeStyle = 'rgba(0,0,0,0.12)';
      g.lineWidth = 1;
      g.strokeRect(0.5, 0.5, this.w - 1, this.h - 1);
    });
  }

  tapes(g: G) {
    const r = rng(this.seed * 13);
    this.frame(g, () => {
      const b = this.border;
      const at: Record<string, [number, number, number]> = {
        tl: [-b * 0.4, -b * 0.4, -0.72], tr: [this.w + b * 0.4, -b * 0.4, 0.72],
        br: [this.w + b * 0.4, this.h + b * 0.4, -0.72], bl: [-b * 0.4, this.h + b * 0.4, 0.72],
      };
      for (const c of this.corners) {
        const [x, y, a] = at[c];
        tape(g, x, y, 118, 34, a + (r() - 0.5) * 0.25, this.seed * 31 + c.charCodeAt(1));
      }
    });
  }

  /** The page area the print covers, as turned, `pad` px beyond the picture on every side (tape reaches ~70). */
  bounds(pad: number) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    const hw = this.w / 2 + pad, hh = this.h / 2 + pad;
    const ex = Math.abs(c) * hw + Math.abs(s) * hh, ey = Math.abs(s) * hw + Math.abs(c) * hh;
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    return { x: cx - ex, y: cy - ey, w: 2 * ex, h: 2 * ey };
  }

  /** Where the caption goes: just under the print, a little in from its left edge. */
  get below() { return { x: this.x + 4, y: this.y + this.h + this.border + 36 }; }
}

/** Typewritten caption under a print. */
export function caption(g: G, text: string, x: number, y: number, size = 22, color = INK2) {
  g.save();
  g.font = `${size}px ${TYPE}`;
  g.fillStyle = color;
  g.textBaseline = 'alphabetic';
  g.fillText(text, x, y);
  g.restore();
}

/** Wrap and set a paragraph at (x, y); returns the y below it. */
export function para(g: G, text: string, x: number, y: number, width: number, o: { size?: number; lh?: number; color?: string; italic?: boolean; font?: string } = {}) {
  const size = o.size ?? 30;
  const lh = o.lh ?? size * 1.47;
  g.save();
  g.font = o.font ?? `${o.italic ? 'italic ' : ''}${size}px ${SERIF}`;
  g.fillStyle = o.color ?? INK;
  g.textBaseline = 'alphabetic';
  let line = '';
  const out: string[] = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > width && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  out.forEach((l, i) => g.fillText(l, x, y + i * lh + size * 0.9));
  g.restore();
  return y + out.length * lh;
}

/** Text centred at (x, y), shrunk to fit `max` px if need be. */
export function label(g: G, text: string, x: number, y: number, font: string, color = INK, max = 1e9, align: CanvasTextAlign = 'center') {
  g.save();
  g.font = font;
  const w = g.measureText(text).width;
  if (w > max) {
    g.translate(x, y);
    g.scale(max / w, 1);
    g.translate(-x, -y);
  }
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(text, x, y);
  g.restore();
}

/** A dot of red ink travelling along a polyline, u in 0..1 (nothing drawn outside that). */
export function travel(g: G, pts: [number, number][], u: number, color = RED, r = 7) {
  if (u < 0 || u > 1) return;
  let total = 0;
  const seg: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    seg.push(l);
    total += l;
  }
  let d = u * total;
  let i = 0;
  while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
  const k = seg[i] ? d / seg[i] : 0;
  const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k;
  const y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k;
  g.save();
  g.fillStyle = color;
  g.globalAlpha = Math.min(1, Math.sin(Math.PI * u) * 3);
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

export const typeFont = (px: number) => `${px}px ${TYPE}`;
export const serifFont = (px: number, italic = false) => `${italic ? 'italic ' : ''}${px}px ${SERIF}`;
