import { SPECIES } from '../sim/Species';
import { ICONS } from '../ui/icons';
import { Page, PAGE_W, PAGE_H, SERIF, TYPE, type PageStyle } from './Page';

const STYLE: PageStyle = {
  paper: '#ece5cf',
  ink: '#2a2622',
  ink2: '#5a544b',
  ink3: '#8c8475',
  accent: '#34505c',
  ruled: true,
  margin: 124,
};

const STORE = 'ps-fieldlog';
const PER_INDEX_PAGE = 12;

/**
 * The field notebook: what the visitor has logged by clicking animals in the water.
 * Page 0 is its title page, then an index spread (click an entry to jump to it), then one page per species.
 * Pages are redrawn in place when something is logged, so the book's textures just re-upload.
 */
export class FieldLog {
  keys: string[];
  found = new Map<string, number>(); // key -> seconds into the dive when first logged
  pages: Page[] = [];
  private icons = new Map<string, { ink: HTMLImageElement; faint: HTMLImageElement }>();
  private indexCount: number;

  constructor() {
    this.keys = Object.keys(SPECIES);
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, number>;
      for (const [k, t] of Object.entries(saved)) if (SPECIES[k]) this.found.set(k, t);
    } catch { /* ignore */ }
    this.indexCount = Math.ceil(this.keys.length / PER_INDEX_PAGE);
    const total = 1 + this.indexCount + this.keys.length;
    for (let i = 0; i < total; i++) this.pages.push(new Page({ ...STYLE, header: i === 0 ? undefined : 'Field log · Puget Sound, 30 ft' }, i === 0 ? undefined : i));
    this.render();
    this.loadIcons().then(() => this.render());
  }

  get count() { return this.found.size; }
  has(key: string) { return this.found.has(key); }
  speciesPage(key: string) { return 1 + this.indexCount + this.keys.indexOf(key); }

  /** Record a species; returns true if it's new. */
  log(key: string, t: number): boolean {
    if (this.found.has(key) || !SPECIES[key]) return false;
    this.found.set(key, t);
    try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(this.found))); } catch { /* ignore */ }
    this.render();
    return true;
  }

  private async loadIcons() {
    const load = (svg: string) => new Promise<HTMLImageElement>((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(img);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    await Promise.all(this.keys.map(async (k) => {
      const inner = (ICONS[k] ?? '').replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
      const svg = (stroke: string, w: number) =>
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 44" width="360" height="264" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
      const [ink, faint] = await Promise.all([load(svg('#34505c', 1.3)), load(svg('rgba(90,84,75,0.28)', 1.2))]);
      this.icons.set(k, { ink, faint });
    }));
  }

  private time(t: number) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  render() {
    this.renderTitle(this.pages[0]);
    for (let i = 0; i < this.indexCount; i++) this.renderIndex(this.pages[1 + i], i);
    this.keys.forEach((k) => this.renderSpecies(this.pages[this.speciesPage(k)], k));
  }

  private renderTitle(p: Page) {
    p.clear();
    const g = p.g;
    g.textAlign = 'center';
    g.fillStyle = STYLE.ink3;
    g.font = `26px ${TYPE}`;
    g.fillText('FIELD LOG', PAGE_W / 2, 360);
    g.fillStyle = STYLE.ink;
    g.font = `58px ${TYPE}`;
    g.fillText('Puget Sound', PAGE_W / 2, 450);
    g.font = `30px ${TYPE}`;
    g.fillStyle = STYLE.ink2;
    g.fillText('rocky bottom · 30 ft · visibility 5 m', PAGE_W / 2, 510);
    g.font = `44px ${TYPE}`;
    g.fillStyle = STYLE.accent;
    g.fillText(`${this.count} of ${this.keys.length} species logged`, PAGE_W / 2, 680);
    g.font = `italic 32px ${SERIF}`;
    g.fillStyle = STYLE.ink2;
    ['Click an animal in the water to log it.', 'Turn the page for the index;', 'click an entry to read about it.'].forEach((l, i) =>
      g.fillText(l, PAGE_W / 2, 820 + i * 50));
    g.textAlign = 'left';
    p.version++;
  }

  private renderIndex(p: Page, n: number) {
    p.clear();
    const g = p.g;
    p.text(n === 0 ? 'Index' : 'Index, continued', `44px ${TYPE}`, STYLE.ink, p.left, 70);
    const keys = this.keys.slice(n * PER_INDEX_PAGE, (n + 1) * PER_INDEX_PAGE);
    const colW = (p.right - p.left) / 2;
    const rowH = 176;
    keys.forEach((k, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = p.left + col * colW;
      const y = 230 + row * rowH;
      const got = this.found.has(k);
      const ic = this.icons.get(k);
      if (ic) g.drawImage(got ? ic.ink : ic.faint, x - 12, y - 6, 180, 132);
      g.font = `28px ${TYPE}`;
      g.fillStyle = got ? STYLE.ink : STYLE.ink3;
      const name = got ? SPECIES[k].name : '? ? ?';
      const lines = p.wrap(name, colW - 190);
      lines.slice(0, 2).forEach((l, j) => g.fillText(l, x + 180, y + 52 + j * 36));
      if (got) {
        g.font = `22px ${TYPE}`;
        g.fillStyle = STYLE.ink3;
        g.fillText(`logged ${this.time(this.found.get(k)!)}`, x + 180, y + 52 + lines.slice(0, 2).length * 36 + 4);
      }
      p.hit(x - 14, y - 10, colW - 10, rowH - 16, { page: this.speciesPage(k) });
    });
    p.version++;
  }

  private renderSpecies(p: Page, k: string) {
    p.clear();
    const g = p.g;
    const def = SPECIES[k];
    const got = this.found.has(k);
    p.text(got ? def.name : 'Not yet logged', `46px ${TYPE}`, got ? STYLE.ink : STYLE.ink3, p.left, 64);
    if (got) p.text(def.latin, `italic 32px ${SERIF}`, STYLE.ink2, p.left, 48);
    const ic = this.icons.get(k);
    if (ic) g.drawImage(got ? ic.ink : ic.faint, p.left + 40, 300, 600, 440);
    p.y = 800;
    if (got) {
      p.text(`Logged ${this.time(this.found.get(k)!)} into the dive.`, `28px ${TYPE}`, STYLE.ink3, p.left, 52);
      p.y += 20;
      p.text('Notes', `34px ${TYPE}`, STYLE.ink, p.left, 52);
      p.text('TO DO', `33px ${SERIF}`, STYLE.ink2, p.left, 52);
    } else {
      p.text('Find one in the water and click it.', `italic 32px ${SERIF}`, STYLE.ink2, p.left, 52);
    }
    p.g.font = `24px ${TYPE}`;
    p.g.fillStyle = STYLE.accent;
    p.g.fillText('← index', p.left, PAGE_H - 170);
    p.hit(p.left - 10, PAGE_H - 205, 180, 50, { page: 1 });
    p.version++;
  }
}
