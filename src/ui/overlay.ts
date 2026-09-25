import { content } from '../content';
import { ICONS } from './icons';
import { SPECIES } from '../sim/Species';

/** CC BY / BY-NC models used in the scene (the rest are CC0). Keep in sync with public/models/CREDITS.md. */
const CREDITS = [
  { title: 'Northern Kelp Crab (Pugettia producta)', author: 'RosarioBeachMarineLab', url: 'https://sketchfab.com/3d-models/be6a8ff47c0447b49d36473db0f5a782' },
  { title: 'Sunflower Sea Star', author: 'RISDNaturelab', url: 'https://sketchfab.com/3d-models/cc973ed5fcd748c8aab5f37ae6b7b6f1' },
  { title: 'Unknown Rock (127.5A)', author: 'RISDNaturelab', url: 'https://sketchfab.com/3d-models/781e3bb90e0f4c1ca81ab9aafab2bf76' },
  { title: 'Spotted Harbor Seal', author: 'c4rn4g3', url: 'https://sketchfab.com/3d-models/eff1b6181eca4a8aaca2cb0a19a1df38' },
  { title: 'Orca Killer Whale', author: 'LostPlaces', url: 'https://sketchfab.com/3d-models/7c01c438ff03401d8e77127154c041c7' },
  { title: 'High-Poly Humpback Whale', author: 'K9239', url: 'https://sketchfab.com/3d-models/5a6a09f1c27e4d0f890f2a30c10d7a81' },
  { title: 'Log', author: 'megalitharchive', url: 'https://sketchfab.com/3d-models/86272f8b02bc4de1af5626e00c474edb' },
  { title: 'Model 75A - Harbor Porpoise (CC BY-NC)', author: 'DigitalLife3D', url: 'https://sketchfab.com/3d-models/eb02e57f17d741329a66844a3a8d2094' },
];

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
        <p class="dim">This page is a notebook kept on the seafloor. Everything moving behind it is simulated: nothing is a video, and each animal is doing something for a reason. Keep still and things come to you. Click an animal to read its tag.</p>
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
        <p class="small">Ticked as they pass the camera. ${Object.keys(SPECIES).length} kinds live here; the visitors (seals, orcas, porpoises, now and then a humpback) come and go on their own schedule.</p>
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
        <p class="small">Photogrammetry scans, cleaned up in Blender, rendered with Three.js, no framework. The rockfish really are curious about divers.</p>
        <details class="credits">
          <summary>Credits</summary>
          <p class="small">Most animals are CC0 photogrammetry by <a href="https://sketchfab.com/ffishAsia-and-floraZia" target="_blank" rel="noopener">ffishAsia &amp; floraZia</a>. The scans below are CC BY 4.0 (one CC BY-NC); all scans were re-oriented, decimated and re-baked for this scene. Ground textures are CC0 from Poly Haven.</p>
          <ul class="plain small">
            ${CREDITS.map((c) => `<li><a href="${c.url}" target="_blank" rel="noopener">${esc(c.title)}</a> by ${esc(c.author)}</li>`).join('')}
          </ul>
        </details>
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
  // on the left half of the screen the tag hangs to the left of the animal, away from the page
  l.classList.toggle('left', x < window.innerWidth / 2);
  l.style.left = x + 'px';
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
