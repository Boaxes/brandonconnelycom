import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import type { Book3D } from '../book/Book3D';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** width of each button's box (CSS px): the buttons sit at its left, against the book */
const BOX_W = 260;
/** a button's height plus the space under it (CSS px), at full size */
const PITCH = 38;
/** gap between the book's edge and the buttons (CSS px) */
const GAP = 14;

/**
 * The section buttons, spaced down the open book's right edge. They're ordinary buttons (they don't
 * pretend to be part of the book), but they're placed in the book's own space, so they move with it and
 * grow when it's brought closer to read, instead of staying put on the screen. Sized so that, with the
 * book at reading distance, they show at their CSS size (smaller where the screen has no room for that).
 */
export class SectionMarks {
  private renderer = new CSS3DRenderer();
  private objects: CSS3DObject[] = [];
  private buttons: HTMLButtonElement[] = [];
  private active = -1;
  private on = false;
  /** when they were last hidden (they're still placed while they fade out) */
  private offAt = -Infinity;
  /** the widest button at full size (CSS px) */
  private widest = BOX_W;

  constructor(sections: { label: string; page: number }[], private book: Book3D, go: (i: number) => void) {
    const root = this.renderer.domElement;
    root.id = 'marks';
    root.setAttribute('role', 'navigation');
    root.setAttribute('aria-label', 'Sections of the portfolio');
    document.body.appendChild(root);
    sections.forEach((s, i) => {
      const box = document.createElement('div');
      box.className = 'mark-box';
      box.style.width = BOX_W + 'px';
      box.innerHTML = `<button class="mark" type="button" data-i="${i}"><span class="n">${String(i + 1).padStart(2, '0')}</span>${esc(s.label)}</button>`;
      const b = box.firstElementChild as HTMLButtonElement;
      b.addEventListener('click', () => go(i));
      const o = new CSS3DObject(box);
      book.edge.add(o);
      this.objects.push(o);
      this.buttons.push(b);
    });
    root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    // the widest label decides how much room they need beside the book
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden';
    probe.append(...this.buttons.map((b) => b.cloneNode(true)));
    document.body.appendChild(probe);
    this.widest = Math.max(...[...probe.children].map((c) => (c as HTMLElement).offsetWidth));
    probe.remove();
    book.sideRoom = Math.ceil(this.widest + GAP + 28);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize() { this.renderer.setSize(window.innerWidth, window.innerHeight); }

  /** Show or hide them, highlight section `active`, and place them for this frame. */
  update(on: boolean, active: number, camera: THREE.PerspectiveCamera) {
    if (on !== this.on) {
      this.on = on;
      if (!on) this.offAt = performance.now();
      this.renderer.domElement.classList.toggle('on', on);
      for (const b of this.buttons) b.tabIndex = on ? 0 : -1;
    }
    if (active !== this.active) {
      this.active = active;
      this.buttons.forEach((b, i) => b.classList.toggle('on', i === active));
    }
    if (!on && performance.now() - this.offAt > 600) return;
    // world metres per CSS px at the book, as it's held at reading distance (brought closer, it all grows)
    const book = this.book;
    const d = book.heldDistance(camera) - book.pageDepth;
    const t = Math.tan(THREE.MathUtils.degToRad((book.fitFov ?? camera.fov) / 2));
    const mPerPx = (2 * d * t) / window.innerHeight;
    // shrink to fit where the screen is small: down the page's height, and across the room beside it
    const n = this.objects.length;
    const pagePx = book.pageHeight / mPerPx;
    const roomPx = (window.innerWidth - (2 * book.pageWidth + 0.008) / mPerPx) / 2;
    // (the room across allows for the book's tilt carrying its lower corner a little further out)
    const k = Math.min(1, pagePx / (n * PITCH), Math.max(0.4, (roomPx * 0.95 - GAP - 10) / this.widest));
    // spaced out down most of the edge
    const pitch = THREE.MathUtils.clamp((pagePx * 0.9) / n, PITCH * k, PITCH * 1.9) * mPerPx;
    this.objects.forEach((o, i) => {
      o.scale.setScalar(mPerPx * k);
      o.position.set((GAP + (BOX_W / 2) * k) * mPerPx, ((n - 1) / 2 - i) * pitch, 0);
    });
    this.renderer.render(book.edge as unknown as THREE.Scene, camera);
  }
}
