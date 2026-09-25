import { content } from '../content';
import { ICONS } from './icons';
import { SPECIES } from '../sim/Species';

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export interface UICallbacks {
  onWatch(on: boolean): void;
  onAudio(on: boolean): void;
}

const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

export function buildUI(cb: UICallbacks) {
  const c = content;
  // site-relative links get the deploy base path (e.g. /repo/ on GitHub Pages)
  const resume = c.links.resume.startsWith('/') ? import.meta.env.BASE_URL + c.links.resume.slice(1) : c.links.resume;
  const root = document.getElementById('ui')!;

  const speciesLog = Object.values(SPECIES)
    .map((d) => `<div class="sp" data-key="${d.key}">${ICONS[d.key] ?? ''}<span>${esc(d.name)}</span><span class="tick">✓</span></div>`)
    .join('');

  const column = el(`
    <main id="content">
      <header id="head">
        <h1 class="name" style="margin:0;font-size:20px">${esc(c.name)}<small>${esc(c.title)} · ${esc(c.location)}</small></h1>
        <nav>
          <a href="#top">Start</a>
          <a href="#about">About</a>
          <a href="#work">Work</a>
          <a href="#experience">Experience</a>
          <a href="#skills">Skills</a>
          <a href="#log">Field log</a>
          <a href="#contact">Contact</a>
          <a class="stamp resume" href="${esc(resume)}" target="_blank" rel="noopener">Resume</a>
        </nav>
      </header>

      <section class="entry" id="top">
        <p class="date">${esc(today)} · Puget Sound · bottom, ~18 m</p>
        <h1>${esc(c.tagline)}</h1>
        <p class="dim">This page is a notebook kept on the seafloor. Everything moving behind it is simulated: nothing is a video, and each animal is doing something for a reason. Scroll to drift along the bottom. Hover an animal to read its tag.</p>
        <div class="links">
          <a href="#work">Selected work</a>
          <a href="${esc(c.links.github)}" target="_blank" rel="noopener">GitHub</a>
          <a href="${esc(c.links.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>
          <a href="mailto:${esc(c.email)}">Email</a>
        </div>
      </section>

      <section class="entry" id="about">
        <p class="date">Entry 1 · About</p>
        <h2>The unglamorous middle of the stack</h2>
        ${c.about.map((p) => `<p>${esc(p)}</p>`).join('')}
      </section>

      <section class="entry" id="work">
        <p class="date">Entry 2 · Selected work</p>
        <h2>Things I have built</h2>
        ${c.projects
          .map(
            (p) => `
          <article class="project">
            <div class="meta">${esc(p.meta)}</div>
            <h3>${esc(p.name)}</h3>
            <p class="small">${esc(p.blurb)}</p>
            <div class="tags">${p.tags.map(esc).join(' · ')}</div>
            <a class="more" href="${esc(p.link)}">notes →</a>
          </article>`,
          )
          .join('')}
      </section>

      <section class="entry" id="experience">
        <p class="date">Entry 3 · Experience</p>
        <h2>Where I have worked</h2>
        <div class="timeline">
          ${c.experience
            .map(
              (e) => `
            <div class="item">
              <div class="when">${esc(e.when)}</div>
              <div>
                <h3>${esc(e.role)} — ${esc(e.org)}</h3>
                <p class="small">${esc(e.blurb)}</p>
              </div>
            </div>`,
            )
            .join('')}
        </div>
      </section>

      <section class="entry" id="skills">
        <p class="date">Entry 4 · Toolkit</p>
        <h2>What I reach for</h2>
        <div class="skills">
          ${Object.entries(c.skills)
            .map(([k, v]) => `<div><h3>${esc(k)}</h3><ul class="plain">${v.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>`)
            .join('')}
        </div>
      </section>

      <section class="entry" id="log">
        <p class="date">Entry 5 · Field log</p>
        <h2>Species observed</h2>
        <p class="small">Ticked as they pass the camera. ${Object.keys(SPECIES).length} kinds live here; the visitors (orca, dolphins, porpoises, the humpback) come and go on their own schedule.</p>
        <div class="log">${speciesLog}</div>
        <p class="log-note" id="log-note">0 observed so far.</p>
        <hr class="rule" />
        <div id="station">
          <div><span>depth</span><b id="hud-depth">—</b></div>
          <div><span>water</span><b id="hud-temp">—</b></div>
          <div><span>light</span><b id="hud-light">—</b></div>
          <div><span>in view</span><b id="hud-count">—</b></div>
          <div><span>elapsed</span><b id="hud-time">00:00</b></div>
        </div>
      </section>

      <section class="entry" id="contact">
        <p class="date">Entry 6 · Contact</p>
        <h2>Say hello</h2>
        <p>Email is fastest: <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>.</p>
        <p class="dim">Also on <a href="${esc(c.links.github)}" target="_blank" rel="noopener">GitHub</a> and <a href="${esc(c.links.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>.</p>
        <p class="small">Modelled procedurally in Blender, rendered with Three.js, no framework. The seals really do have to surface to breathe.</p>
      </section>
    </main>`);

  const controls = el(`
    <div id="controls">
      <button class="btn btn-watch" id="btn-watch" aria-pressed="false" title="Hide the notebook (W)">Watch the water</button>
      <button class="btn" id="btn-audio" aria-pressed="false" title="Ambient sound">Sound off</button>
    </div>`);

  root.appendChild(column);
  document.body.appendChild(controls);

  const btnWatch = controls.querySelector<HTMLButtonElement>('#btn-watch')!;
  const btnAudio = controls.querySelector<HTMLButtonElement>('#btn-audio')!;
  let watching = false;
  const setWatch = (on: boolean) => {
    watching = on;
    document.body.classList.toggle('watch', on);
    btnWatch.setAttribute('aria-pressed', String(on));
    btnWatch.textContent = on ? 'Back to the notebook' : 'Watch the water';
    cb.onWatch(on);
  };
  btnWatch.addEventListener('click', () => setWatch(!watching));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'w' || e.key === 'W') {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      setWatch(!watching);
    }
    if (e.key === 'Escape' && watching) setWatch(false);
  });
  let audio = false;
  btnAudio.addEventListener('click', () => {
    audio = !audio;
    btnAudio.setAttribute('aria-pressed', String(audio));
    btnAudio.textContent = audio ? 'Sound on' : 'Sound off';
    cb.onAudio(audio);
  });

  // active nav link
  const links = Array.from(column.querySelectorAll<HTMLAnchorElement>('nav a[href^="#"]'));
  const sections = links.map((a) => document.querySelector<HTMLElement>(a.getAttribute('href')!)!);
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const i = sections.indexOf(e.target as HTMLElement);
          links.forEach((l, j) => l.classList.toggle('active', i === j));
        }
      }
    },
    { rootMargin: '-40% 0px -50% 0px' },
  );
  sections.forEach((s) => io.observe(s));

  const seen = new Set<string>();
  return {
    setHud(v: { depth: number; temp: number; light: number; count: number; time: number }) {
      document.getElementById('hud-depth')!.textContent = v.depth.toFixed(1) + ' m';
      document.getElementById('hud-temp')!.textContent = v.temp.toFixed(1) + ' °C';
      document.getElementById('hud-light')!.textContent = Math.round(v.light * 100) + ' % of surface';
      document.getElementById('hud-count')!.textContent = String(v.count) + ' animals';
      const m = Math.floor(v.time / 60);
      const s = Math.floor(v.time % 60);
      document.getElementById('hud-time')!.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    },
    markObserved(key: string) {
      if (seen.has(key)) return;
      seen.add(key);
      column.querySelector(`.sp[data-key="${key}"]`)?.classList.add('seen');
      document.getElementById('log-note')!.textContent = `${seen.size} of ${Object.keys(SPECIES).length} observed so far.`;
    },
  };
}

export function showLabel(x: number, y: number, name: string, latin: string, doing: string) {
  const l = document.getElementById('label')!;
  l.hidden = false;
  l.innerHTML = `<div class="name">${esc(name)}</div><div class="latin">${esc(latin)}</div><div class="doing">${esc(doing)}</div>`;
  const w = 270;
  const left = Math.min(x, window.innerWidth - w - 10);
  l.style.left = left + 'px';
  l.style.top = y + 'px';
}

export function hideLabel() {
  document.getElementById('label')!.hidden = true;
}

export function loaderProgress(p: number, sub?: string) {
  const f = document.getElementById('loader-fill');
  if (f) f.style.width = Math.round(p * 100) + '%';
  if (sub) {
    const s = document.getElementById('loader-sub');
    if (s) s.textContent = sub;
  }
}

export function loaderDone() {
  const l = document.getElementById('loader');
  if (!l) return;
  l.classList.add('done');
  setTimeout(() => l.remove(), 1200);
}

export function showFallback(message: string) {
  const l = document.getElementById('loader');
  l?.remove();
  const f = el(`<div id="fallback"></div>`);
  document.body.prepend(f);
  const n = el(`<p class="small" style="position:fixed;right:24px;bottom:20px;z-index:20;color:#efe8d6">${esc(message)}</p>`);
  document.body.appendChild(n);
}
