import { SPECIES } from '../sim/Species';
import { NOTES } from '../sim/speciesNotes';
import { PHOTOS, photoUrl } from './speciesPhotos';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const time = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** A photo print taped into the notebook (or an empty frame for a species not yet seen). */
const print = (k: string, got: boolean, big = false) => got
  ? `<span class="print${big ? ' big' : ''}"><img src="${photoUrl(k)}" alt="${esc(SPECIES[k].name)}" loading="lazy" decoding="async"></span>`
  : `<span class="print empty${big ? ' big' : ''}" aria-hidden="true">?</span>`;

/**
 * The field notebook: what the visitor has logged by clicking animals in the water this visit.
 * A sheet of ruled paper down the middle of the screen: an index of every species (the ones not yet
 * seen are empty frames and question marks), and a page for each one with a photo, notes written for
 * this site from NOAA Fisheries, Wikipedia and others (src/sim/speciesNotes.ts), and their sources.
 */
export class FieldLog {
  keys = Object.keys(SPECIES);
  found = new Map<string, number>(); // key -> seconds into the dive when first logged
  onClose: (() => void) | null = null;
  private root: HTMLElement;
  private body: HTMLElement;
  private view: string | null = null; // null = index, else a species key

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'fieldlog';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Field log');
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="sheet">
        <button class="close" aria-label="Close the field log" title="Close (L / Esc)">×</button>
        <div class="body"></div>
      </div>`;
    document.body.appendChild(this.root);
    this.body = this.root.querySelector('.body')!;
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.root || t.closest('.close')) return this.close();
      const sp = t.closest<HTMLElement>('[data-sp]');
      if (sp) return this.show(sp.dataset.sp!);
      if (t.closest('[data-back]')) this.show(null);
    });
    this.root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  }

  get count() { return this.found.size; }
  get isOpen() { return !this.root.hidden; }
  has(key: string) { return this.found.has(key); }

  /** Record a species; returns true if it's new. */
  log(key: string, t: number): boolean {
    if (this.found.has(key) || !SPECIES[key]) return false;
    this.found.set(key, t);
    if (this.isOpen) this.render();
    return true;
  }

  open(key: string | null = null) {
    this.view = key;
    this.render();
    this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.add('on'));
  }

  close() {
    if (!this.isOpen) return;
    this.root.classList.remove('on');
    setTimeout(() => { if (!this.root.classList.contains('on')) this.root.hidden = true; }, 350);
    this.onClose?.();
  }

  toggle() { if (this.isOpen) this.close(); else this.open(); }

  private show(key: string | null) {
    this.view = key;
    this.render();
    this.root.querySelector('.sheet')!.scrollTop = 0;
  }

  private render() {
    this.body.innerHTML = this.view ? this.speciesPage(this.view) : this.index();
  }

  private index() {
    const rows = this.keys.map((k) => {
      const got = this.found.has(k);
      const def = SPECIES[k];
      return `<button class="sp${got ? ' seen' : ''}" data-sp="${k}">${print(k, got)}<span>${got ? esc(def.name) : '? ? ?'}${got ? `<small>logged ${time(this.found.get(k)!)}</small>` : ''}</span><span class="tick">✓</span></button>`;
    }).join('');
    return `
      <p class="date">FIELD LOG · PUGET SOUND · ROCKY BOTTOM, 30 FT · VISIBILITY 5 M</p>
      <h1>${this.count} of ${this.keys.length} species logged</h1>
      <p class="dim">Click an animal in the water to log it. Click an entry here to read about it.</p>
      <div class="log">${rows}</div>`;
  }

  private speciesPage(k: string) {
    const def = SPECIES[k];
    const got = this.found.has(k);
    if (!got) {
      return `
      <button class="back" data-back>← index</button>
      <div class="specimen-page">
        ${print(k, false, true)}
        <h1>Not yet logged</h1>
        <p class="dim">Find one in the water and click it.</p>
      </div>`;
    }
    const n = NOTES[k];
    const ph = PHOTOS[k];
    const facts = n ? `
        <dl class="facts">
          <dt>Size</dt><dd>${esc(n.size)}</dd>
          <dt>Depth</dt><dd>${esc(n.depth)}</dd>
          <dt>Eats</dt><dd>${esc(n.diet)}</dd>
        </dl>` : '';
    const sources = n ? `
        <p class="sources">Sources: ${n.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join(' · ')}</p>` : '';
    return `
      <button class="back" data-back>← index</button>
      <div class="specimen-page seen">
        <figure>
          ${print(k, true, true)}
          ${ph ? `<figcaption>Photo: <a href="${esc(ph.url)}" target="_blank" rel="noopener">${esc(ph.author)}</a> · ${esc(ph.license)}</figcaption>` : ''}
        </figure>
        <h1>${esc(def.name)}</h1>
        <p class="latin">${esc(def.latin)}</p>
        <p class="date">Logged ${time(this.found.get(k)!)} into the dive.</p>
        <h2>Notes</h2>
        <p>${n ? esc(n.notes) : ''}</p>${facts}${sources}
      </div>`;
  }
}
