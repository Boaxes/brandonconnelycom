import { content } from '../content';

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

export function buildUI(cb: UICallbacks) {
  const c = content;
  const root = document.getElementById('ui')!;

  const topbar = el(`
    <header id="topbar">
      <a class="brand" href="#top">${esc(c.name)} <span>/</span> ${esc(c.title)}</a>
      <nav>
        <a href="#about">About</a>
        <a href="#work">Work</a>
        <a href="#experience">Experience</a>
        <a href="#skills">Skills</a>
        <a href="#contact">Contact</a>
      </nav>
      <div class="spacer"></div>
      <a class="btn primary" href="${esc(c.links.resume)}" target="_blank" rel="noopener">Resume ↗</a>
    </header>`);

  const column = el(`
    <main id="content">
      <section class="panel" id="top">
        <div class="card">
          <p class="eyebrow">${esc(c.location)} · Data engineering</p>
          <h1>${esc(c.name)} builds data systems that hold up.</h1>
          <p class="lede">${esc(c.tagline)}</p>
          <div class="row">
            <a class="btn primary" href="#work">See the work</a>
            <a class="btn" href="${esc(c.links.github)}" target="_blank" rel="noopener">GitHub ↗</a>
            <a class="btn" href="${esc(c.links.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a>
          </div>
          <p class="hint">scroll to drift along the bottom · hover an animal to identify it · <kbd>W</kbd> hides this</p>
        </div>
      </section>

      <section class="panel" id="about">
        <div class="card">
          <p class="eyebrow">About</p>
          <h2>The unglamorous middle of the stack</h2>
          ${c.about.map((p) => `<p>${esc(p)}</p>`).join('')}
        </div>
      </section>

      <section class="panel" id="work">
        <div class="card">
          <p class="eyebrow">Selected work</p>
          <h2>Projects</h2>
          ${c.projects
            .map(
              (p) => `
            <article class="project">
              <div class="meta">${esc(p.meta)}</div>
              <h3>${esc(p.name)}</h3>
              <p>${esc(p.blurb)}</p>
              <div class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
              <a href="${esc(p.link)}">Read more →</a>
            </article>`,
            )
            .join('')}
        </div>
      </section>

      <section class="panel" id="experience">
        <div class="card timeline">
          <p class="eyebrow">Experience</p>
          <h2>Where I've worked</h2>
          ${c.experience
            .map(
              (e) => `
            <div class="item">
              <div class="when">${esc(e.when)}</div>
              <div>
                <h3>${esc(e.role)} · <span style="color:var(--ink-dim);font-weight:400">${esc(e.org)}</span></h3>
                <p>${esc(e.blurb)}</p>
              </div>
            </div>`,
            )
            .join('')}
        </div>
      </section>

      <section class="panel" id="skills">
        <div class="card">
          <p class="eyebrow">Toolkit</p>
          <h2>Skills</h2>
          <div class="skills">
            ${Object.entries(c.skills)
              .map(([k, v]) => `<div><h3>${esc(k)}</h3><ul>${v.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>`)
              .join('')}
          </div>
        </div>
      </section>

      <section class="panel" id="contact">
        <div class="card contact">
          <p class="eyebrow">Contact</p>
          <h2>Say hello</h2>
          <p>The fastest way to reach me is email: <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>.</p>
          <p>Also on <a href="${esc(c.links.github)}" target="_blank" rel="noopener">GitHub</a> and <a href="${esc(c.links.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>.</p>
          <p class="hint">Everything swimming behind this text is modelled procedurally and runs its own little life. Nothing here is a video.</p>
        </div>
      </section>
    </main>`);

  const hud = el(`
    <aside id="hud" aria-label="dive readout">
      <div><span class="dot"></span><span class="k">station</span><span class="v">Puget Sound · bottom</span></div>
      <div><span class="k">depth</span><span class="v" id="hud-depth">— m</span></div>
      <div><span class="k">temp</span><span class="v" id="hud-temp">— °C</span></div>
      <div><span class="k">light</span><span class="v" id="hud-light">— %</span></div>
      <div><span class="k">in view</span><span class="v" id="hud-count">—</span></div>
      <div><span class="k">time</span><span class="v" id="hud-time">00:00</span></div>
    </aside>`);

  const controls = el(`
    <div id="controls">
      <button class="btn" id="btn-watch" aria-pressed="false" title="Hide the text and just watch (W)">Watch the water</button>
      <button class="btn" id="btn-audio" aria-pressed="false" title="Ambient sound">Sound off</button>
    </div>`);

  document.body.appendChild(topbar);
  root.appendChild(column);
  document.body.appendChild(hud);
  document.body.appendChild(controls);

  const btnWatch = controls.querySelector<HTMLButtonElement>('#btn-watch')!;
  const btnAudio = controls.querySelector<HTMLButtonElement>('#btn-audio')!;
  let watching = false;
  const setWatch = (on: boolean) => {
    watching = on;
    document.body.classList.toggle('watch', on);
    btnWatch.setAttribute('aria-pressed', String(on));
    btnWatch.textContent = on ? 'Back to the page' : 'Watch the water';
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
  const links = Array.from(topbar.querySelectorAll<HTMLAnchorElement>('nav a'));
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

  return {
    setHud(v: { depth: number; temp: number; light: number; count: number; time: number }) {
      (document.getElementById('hud-depth')!).textContent = v.depth.toFixed(1) + ' m';
      (document.getElementById('hud-temp')!).textContent = v.temp.toFixed(1) + ' °C';
      (document.getElementById('hud-light')!).textContent = Math.round(v.light * 100) + ' %';
      (document.getElementById('hud-count')!).textContent = String(v.count);
      const m = Math.floor(v.time / 60);
      const s = Math.floor(v.time % 60);
      (document.getElementById('hud-time')!).textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
  const n = el(`<p class="hint" style="position:fixed;left:24px;bottom:20px;z-index:20">${esc(message)}</p>`);
  document.body.appendChild(n);
}
