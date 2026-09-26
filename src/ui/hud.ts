import { content } from '../content';
import { CREDITS } from '../credits';
import { ICONS } from './icons';

const el = <T extends HTMLElement = HTMLElement>(html: string): T => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

const I = {
  book: '<path d="M5 6.5c2.5-1 5.2-1 7 .6 1.8-1.6 4.5-1.6 7-.6v11c-2.5-1-5.2-1-7 .6-1.8-1.6-4.5-1.6-7-.6z"/><path d="M12 7.1v11"/>',
  log: '<rect x="6" y="4" width="12" height="16" rx="1.5"/><path d="M9 8h6M9 11h6M9 14h4"/>',
  left: '<path d="M14.5 6 8.5 12l6 6"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
  up: '<path d="m6 14.5 6-6 6 6"/>',
  down: '<path d="m6 9.5 6 6 6-6"/>',
  waves: '<path d="M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
  sfx: '<path d="M5 10v4h3l4 3.5v-11L8 10z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M17.8 7.3a6.6 6.6 0 0 1 0 9.4"/>',
  eye: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.8"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5M8.5 10.5h4M10.5 8.5v4"/>',
};
const icon = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

export interface HudCallbacks {
  book(): void;
  log(): void;
  look(dYaw: number, dPitch: number): void;
  ambience(on: boolean): void;
  sfx(on: boolean): void;
  watch(on: boolean): void;
  zoom(on: boolean): void;
}

/**
 * The controls: a small paper card in the bottom-right corner (field log, look-around pad, zoom, sound,
 * effects, watch the water) and, once the book has been picked up, a single button at the bottom middle
 * to bring it back up or put it down. Also the discovery animation, hints, and an accessible copy of
 * the portfolio.
 */
export class Hud {
  private root: HTMLElement;
  private heading: HTMLElement;
  private badge: HTMLElement;
  private live: HTMLElement;
  private hint: HTMLElement;
  private logBtn: HTMLElement;
  private bookBtn: HTMLButtonElement;
  private watching = false;

  constructor(private cb: HudCallbacks, prefs: { ambience: boolean; sfx: boolean; zoom: boolean }) {
    this.root = el(`
      <div id="controls" role="toolbar" aria-label="Dive controls">
        <div class="heading" aria-live="polite">N · level</div>
        <div class="grid">
          <button class="ctl" data-a="log" title="Field log (L)" aria-label="Open the field log">${icon(I.log)}<span class="badge" hidden>0</span></button>
          <button class="ctl" data-a="up" title="Look up (W / ↑)" aria-label="Look up">${icon(I.up)}</button>
          <button class="ctl" data-a="watch" aria-pressed="false" title="Watch the water (H)" aria-label="Watch the water">${icon(I.eye)}</button>
          <button class="ctl" data-a="left" title="Look left (A / ←)" aria-label="Look left">${icon(I.left)}</button>
          <button class="ctl" data-a="zoom" aria-pressed="${prefs.zoom}" title="Zoom: scroll to look closer (Z)" aria-label="Zoom with the scroll wheel">${icon(I.zoom)}</button>
          <button class="ctl" data-a="right" title="Look right (D / →)" aria-label="Look right">${icon(I.right)}</button>
          <button class="ctl" data-a="ambience" aria-pressed="${prefs.ambience}" title="Background: the sound of the water" aria-label="Background sound">${icon(I.waves)}</button>
          <button class="ctl" data-a="down" title="Look down (S / ↓)" aria-label="Look down">${icon(I.down)}</button>
          <button class="ctl" data-a="sfx" aria-pressed="${prefs.sfx}" title="Effects: the book, the zoom, the log, the animals" aria-label="Sound effects">${icon(I.sfx)}</button>
        </div>
      </div>`);
    this.bookBtn = el<HTMLButtonElement>(`
      <button id="book-toggle" data-a="book" aria-pressed="false" title="The portfolio (B)">${icon(I.book)}<span>Portfolio</span></button>`);
    document.body.append(this.root, this.bookBtn);
    this.heading = this.root.querySelector('.heading')!;
    this.badge = this.root.querySelector('.badge')!;
    this.logBtn = this.root.querySelector('[data-a="log"]')!;
    const onClick = (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-a]');
      if (!b) return;
      const a = b.dataset.a!;
      if (a === 'book') cb.book();
      else if (a === 'log') cb.log();
      else if (a === 'left') cb.look(-1, 0);
      else if (a === 'right') cb.look(1, 0);
      else if (a === 'up') cb.look(0, 1);
      else if (a === 'down') cb.look(0, -1);
      else if (a === 'ambience' || a === 'sfx' || a === 'zoom') {
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(on));
        (a === 'ambience' ? cb.ambience : a === 'sfx' ? cb.sfx : cb.zoom)(on);
      } else if (a === 'watch') this.setWatch(!this.watching);
    };
    this.root.addEventListener('click', onClick);
    this.bookBtn.addEventListener('click', onClick);

    this.live = el('<div class="sr-only" aria-live="polite"></div>');
    this.hint = el('<div id="hint" hidden></div>');
    document.body.append(this.live, this.hint);
    document.body.appendChild(this.accessibleCopy());
  }

  setWatch(on: boolean) {
    this.watching = on;
    document.body.classList.toggle('watching', on);
    this.root.querySelector('[data-a="watch"]')!.setAttribute('aria-pressed', String(on));
    this.cb.watch(on);
  }
  get isWatching() { return this.watching; }

  setHeading(text: string) { this.heading.textContent = text; }

  /** The book button appears once the book has been picked up; pressed while it's being read. */
  setBook(inHand: boolean, reading: boolean) {
    document.body.classList.toggle('has-book', inHand);
    this.bookBtn.setAttribute('aria-pressed', String(reading));
    this.bookBtn.title = reading ? 'Put the portfolio down (B)' : 'Read the portfolio (B)';
  }

  /** Draw the eye to a control for a few seconds (e.g. the up arrow when something passes overhead). */
  nudge(action: string) {
    const b = this.root.querySelector<HTMLElement>(`[data-a="${action}"]`);
    if (!b) return;
    b.classList.remove('nudge');
    void b.offsetWidth;
    b.classList.add('nudge');
    setTimeout(() => b.classList.remove('nudge'), 6000);
  }

  // ---------------------------------------------------------------- quick jump beside the book

  private jump: HTMLElement | null = null;
  private jumpActive = -1;
  private jumpPos = '';

  /** The quick-jump card: one entry per section of the book; `go` turns straight to it. */
  setSections(sections: { label: string; page: number }[], go: (page: number) => void) {
    this.jump = el(`
      <nav id="jump" aria-label="Jump to a section of the portfolio">
        <div class="heading">Sections</div>
        ${sections.map((s, i) => `<button data-page="${s.page}" data-i="${i}"><span class="n">${String(i + 1).padStart(2, '0')}</span>${esc(s.label)}</button>`).join('')}
      </nav>`);
    document.body.appendChild(this.jump);
    this.jump.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-page]');
      if (b) go(Number(b.dataset.page));
    });
    this.jump.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  }

  /** Show the card beside the book (right edge at `right` px from the left), with `active` highlighted. */
  showJump(on: boolean, active = -1, right = 0, midY = window.innerHeight / 2) {
    if (!this.jump) return;
    document.body.classList.toggle('jump-on', on);
    if (!on) return;
    if (active !== this.jumpActive) {
      this.jumpActive = active;
      this.jump.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === active));
    }
    const w = this.jump.offsetWidth || 180;
    const x = Math.max(16, Math.round(right - w - 22));
    const y = Math.round(midY);
    const pos = `${x},${y}`;
    if (pos !== this.jumpPos) {
      this.jumpPos = pos;
      this.jump.style.left = x + 'px';
      this.jump.style.top = y + 'px';
    }
  }

  setZoom(on: boolean) {
    this.root.querySelector('[data-a="zoom"]')!.setAttribute('aria-pressed', String(on));
  }

  setCount(n: number) {
    this.badge.hidden = n === 0;
    this.badge.textContent = String(n);
  }

  /** A quiet hint under a point on screen (CSS px), or hide it. */
  showHint(text: string | null, x = window.innerWidth / 2, y = window.innerHeight * 0.7) {
    if (!text) {
      this.hint.classList.remove('on');
      return;
    }
    this.hint.style.left = x + 'px';
    this.hint.style.top = y + 'px';
    this.hint.textContent = text;
    this.hint.hidden = false;
    requestAnimationFrame(() => this.hint.classList.add('on'));
  }

  /** A new species: a specimen card pops up where it was clicked and flies into the field log. */
  discover(key: string, name: string, latin: string, x: number, y: number, count: number, total: number) {
    const card = el(`<div class="specimen">${ICONS[key] ?? ''}<div><b>${esc(name)}</b><i>${esc(latin)}</i></div></div>`);
    card.style.left = x + 'px';
    card.style.top = y + 'px';
    document.body.appendChild(card);
    const target = this.logBtn.getBoundingClientRect();
    requestAnimationFrame(() => card.classList.add('in'));
    setTimeout(() => {
      card.classList.add('fly');
      card.style.left = target.left + target.width / 2 + 'px';
      card.style.top = target.top + target.height / 2 + 'px';
    }, 520);
    setTimeout(() => {
      card.remove();
      this.setCount(count);
      this.logBtn.classList.remove('pulse');
      void this.logBtn.offsetWidth;
      this.logBtn.classList.add('pulse');
    }, 920);
    this.live.textContent = `New entry in the field log: ${name} (${latin}), ${count} of ${total} logged.`;
  }

  /** Already logged: a quiet word where it was clicked. */
  whisper(name: string, x: number, y: number) {
    const w = el(`<div class="whisper">${esc(name)} · already logged</div>`);
    w.style.left = x + 'px';
    w.style.top = y + 'px';
    document.body.appendChild(w);
    requestAnimationFrame(() => w.classList.add('on'));
    setTimeout(() => w.remove(), 1500);
  }

  /** The portfolio as plain HTML, visually hidden: for screen readers and search engines. */
  private accessibleCopy() {
    const c = content;
    return el(`
      <main id="sr-copy" class="sr-only">
        <h1>${esc(c.fullName)} — ${esc(c.title)}, ${esc(c.location)}</h1>
        <p>${esc(c.tagline)}</p>
        <h2>About</h2>${c.about.map((p) => `<p>${esc(p)}</p>`).join('')}
        <h2>Selected work</h2>${c.projects.map((p) => `<h3>${esc(p.name)}</h3><p>${esc(p.meta)}</p><p>${esc(p.blurb)}</p>`).join('')}
        <h2>Experience</h2>${c.experience.map((e) => `<h3>${esc(e.role)}, ${esc(e.org)} (${esc(e.when)})</h3><p>${esc(e.blurb)}</p>`).join('')}
        <h2>Toolkit</h2>${Object.entries(c.skills).map(([k, v]) => `<p>${esc(k)}: ${esc(v.join(', '))}</p>`).join('')}
        <h2>Contact</h2>
        <p><a href="mailto:${esc(c.email)}">${esc(c.email)}</a> · <a href="${esc(c.links.github)}">GitHub</a> · <a href="${esc(c.links.linkedin)}">LinkedIn</a> · <a href="${esc(c.links.resume)}">Résumé</a></p>
        <h2>Credits</h2><ul>${CREDITS.map((x) => `<li><a href="${esc(x.url)}">${esc(x.title)}</a> by ${esc(x.author)} (${esc(x.license)})</li>`).join('')}</ul>
      </main>`);
  }
}

// ---------------------------------------------------------------- loader

export function loaderProgress(p: number, sub?: string) {
  const f = document.getElementById('loader-fill');
  if (f) f.style.width = Math.round(p * 100) + '%';
  if (sub) {
    const s = document.getElementById('loader-sub');
    if (s) s.textContent = sub;
  }
}

/**
 * Loaded: the bar gives way to a "View portfolio" button. The visit (and its sound) starts on that click;
 * browsers won't play audio before one.
 */
export function loaderReady(onBegin: () => void) {
  const l = document.getElementById('loader');
  if (!l) return onBegin();
  const inner = l.querySelector('.loader-inner')!;
  inner.innerHTML = `
    <button class="begin" type="button">View portfolio</button>
    <div class="loader-sub">sound on</div>`;
  const b = inner.querySelector<HTMLButtonElement>('.begin')!;
  b.focus({ preventScroll: true });
  b.addEventListener('click', () => onBegin(), { once: true });
}

export function loaderDone() {
  const l = document.getElementById('loader');
  if (!l) return;
  l.classList.add('done');
  setTimeout(() => l.remove(), 500);
}

export function showFallback(message: string) {
  document.getElementById('loader')?.remove();
  document.body.classList.add('fallback');
  const n = el(`<div id="fallback"><p>${esc(message)}</p></div>`);
  document.body.appendChild(n);
  document.getElementById('sr-copy')?.classList.remove('sr-only');
}
