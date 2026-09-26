import * as THREE from 'three';
import { Ocean } from './scene/Ocean';
import { CameraRig } from './scene/CameraRig';
import { loadAll, loadLate } from './scene/Assets';
import { World } from './sim/World';
import { SPECIES } from './sim/Species';
import { stage } from './scene/Terrain';
import { aimTorch } from './scene/Environment';
import { shared } from './scene/UnderwaterMaterial';
import { sound } from './audio/Sound';
import { Book3D } from './book/Book3D';
import { portfolioPages } from './book/portfolio';
import { FieldLog } from './book/fieldlog';
import { content } from './content';
import { Hud, loaderDone, loaderProgress, showFallback } from './ui/hud';

const INTRO = 5.5; // seconds for the light to come up

async function fontsReady() {
  const wait = Promise.all([
    document.fonts.load("33px 'Lora'"),
    document.fonts.load("italic 33px 'Lora'"),
    document.fonts.load("30px 'Special Elite'"),
  ]);
  await Promise.race([wait, new Promise((r) => setTimeout(r, 4000))]);
}

async function boot() {
  const canvas = document.getElementById('ocean') as HTMLCanvasElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let ocean: Ocean;
  try {
    const test = document.createElement('canvas').getContext('webgl2');
    if (!test) throw new Error('no webgl2');
    ocean = new Ocean(canvas);
  } catch (e) {
    console.warn('WebGL unavailable, showing fallback', e);
    new Hud({ book() {}, log() {}, look() {}, ambience() {}, sfx() {}, watch() {}, zoom() {} }, { ambience: false, sfx: false, zoom: false });
    showFallback('Your browser could not start WebGL, so the water is switched off. Here is the portfolio as plain text.');
    return;
  }

  loaderProgress(0.02);
  try {
    await Promise.all([loadAll((p) => loaderProgress(0.05 + p * 0.8)), fontsReady()]);
  } catch (e) {
    console.error(e);
  }

  const rig = new CameraRig(ocean.camera);
  const world = new World(ocean.scene, ocean.camera);
  loaderProgress(0.9, 'settling on the bottom…');
  world.populate(() => ({ yaw: rig.yaw, pitch: rig.pitch }));

  // ---------------------------------------------------------------- the books
  const texLoader = new THREE.TextureLoader();
  const tex = (name: string, srgb: boolean) => {
    const t = texLoader.load(import.meta.env.BASE_URL + 'textures/' + name);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1.4, 1.4);
    t.anisotropy = 8;
    return t;
  };
  const leather = { map: tex('leather_diff.jpg', true), normal: tex('leather_nor_gl.jpg', false) };
  const portfolio = new Book3D({
    width: 0.2, height: 0.28, thickness: 0.03, cover: 0xc23a2c, foil: '#d9b76a', leather,
    title: [content.fullName, 'Portfolio', content.title], endpaper: '#6e2a22',
  }, portfolioPages());
  const field = new FieldLog();
  const logBook = new Book3D({
    width: 0.15, height: 0.21, thickness: 0.016, cover: 0x6a7a55, foil: '#e7dcb8', leather,
    title: ['Field log', 'Puget Sound', '30 ft'], endpaper: '#3b4633',
  }, field.pages);
  ocean.scene.add(portfolio.root, logBook.root);
  logBook.root.visible = false;
  portfolio.onSound = logBook.onSound = (s) => sound.play(s);
  // both books are held in the diver's hands, sized to the unzoomed view
  for (const b of [portfolio, logBook]) {
    b.holder = rig.hands;
    b.fitFov = rig.baseFov;
  }
  {
    const s = stage();
    portfolio.placeAtRest(world.bookRest.pos, world.bookRest.up, s.fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.12));
  }
  const reading = () => (portfolio.reading ? portfolio : logBook.reading ? logBook : null);

  // ---------------------------------------------------------------- controls
  // scroll-to-zoom is on unless the visitor switched it off
  let zoomOn = true;
  try { zoomOn = localStorage.getItem('ps-zoom') !== 'off'; } catch { /* private mode */ }
  const setZoomOn = (on: boolean) => {
    zoomOn = on;
    if (!on) rig.setZoom(1);
    try { localStorage.setItem('ps-zoom', on ? 'on' : 'off'); } catch { /* ignore */ }
  };
  let quietWatch = false; // set while syncing the watch button without side effects
  const hud = new Hud({
    book: () => toggleBook(),
    log: () => toggleLog(),
    look: (y, p) => rig.step(y, p),
    zoom: (on) => setZoomOn(on),
    ambience: (on) => { sound.unlock(); sound.setAmbience(on); },
    sfx: (on) => { sound.unlock(); sound.setSfx(on); },
    watch: (on) => {
      if (quietWatch) return;
      if (on) {
        portfolio.lower();
        logBook.lower();
      } else if (portfolio.inHand) portfolio.raise();
    },
  }, { ambience: sound.ambienceOn, sfx: sound.sfxOn, zoom: zoomOn });
  hud.setCount(field.count);
  const leaveWatch = () => {
    if (!hud.isWatching) return;
    quietWatch = true;
    hud.setWatch(false);
    quietWatch = false;
  };
  const toggleBook = () => {
    sound.unlock();
    rig.setZoom(1);
    if (portfolio.state === 'rest') {
      portfolio.pickUp();
      hud.showHint(null);
    } else if (portfolio.state === 'lowered' || portfolio.state === 'lowering') {
      logBook.lower();
      leaveWatch();
      portfolio.raise();
    } else portfolio.lower();
  };
  const toggleLog = () => {
    sound.unlock();
    rig.setZoom(1);
    if (logBook.state === 'lowered' || logBook.state === 'lowering') {
      portfolio.lower();
      leaveWatch();
      field.render();
      logBook.refresh();
      logBook.raise();
    } else logBook.lower();
  };
  rig.onChange = () => hud.setHeading(`${rig.heading} · ${rig.pitchLabel}`);
  // orcas or the whale overhead: nudge the up arrow unless the diver is already looking up
  world.director.onLookUp = () => { if (rig.pitchStep < 1) hud.nudge('up'); };

  // pointer: click a page or a link, pick up the book, log an animal; drag to turn in steps
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const bookHit = (x: number, y: number) => {
    ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, ocean.camera);
    for (const b of [portfolio, logBook]) {
      const hit = ray.intersectObjects(b.targets(), true)[0];
      if (hit) return { book: b, hit };
    }
    return null;
  };
  let down: { x: number; y: number; drag: boolean } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, drag: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 14) {
      down.drag = true;
      canvas.classList.add('grab');
    }
    if (!down) {
      const h = bookHit(e.clientX, e.clientY);
      canvas.classList.toggle('pointer', !!(h && h.book.describe(h.hit)));
    }
  });
  window.addEventListener('pointerup', (e) => {
    if (!down) return;
    const d = down;
    down = null;
    canvas.classList.remove('grab');
    if (d.drag) {
      // like grabbing the world: drag left to look right; roughly one step per 200 px, at most two
      const sx = THREE.MathUtils.clamp(Math.round((d.x - e.clientX) / 200), -2, 2);
      const sy = THREE.MathUtils.clamp(Math.round((e.clientY - d.y) / 160), -2, 2);
      if (sx || sy) rig.step(sx, sy);
      return;
    }
    sound.unlock();
    const h = bookHit(e.clientX, e.clientY);
    if (h) {
      const wasRest = h.book.state === 'rest';
      if (h.book.click(h.hit) && wasRest) hud.showHint(null);
      return;
    }
    const a = world.pick(e.clientX, e.clientY);
    if (!a) return;
    const def = SPECIES[a.key];
    if (field.log(a.key, simT)) {
      sound.play('discover');
      hud.discover(a.key, def.name, def.latin, e.clientX, e.clientY, field.count, field.keys.length);
      logBook.refresh();
    } else hud.whisper(def.name, e.clientX, e.clientY);
  });
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const book = reading();
    switch (e.key) {
      case 'ArrowLeft': if (book) book.prev(); else rig.step(-1, 0); break;
      case 'ArrowRight': if (book) book.next(); else rig.step(1, 0); break;
      case 'PageUp': book?.prev(); break;
      case 'PageDown': case ' ': book?.next(); break;
      case 'ArrowUp': case 'w': case 'W': rig.step(0, 1); break;
      case 'ArrowDown': case 's': case 'S': rig.step(0, -1); break;
      case 'a': case 'A': rig.step(-1, 0); break;
      case 'd': case 'D': rig.step(1, 0); break;
      case 'b': case 'B': toggleBook(); break;
      case 'l': case 'L': toggleLog(); break;
      case 'h': case 'H': hud.setWatch(!hud.isWatching); break;
      case 'z': case 'Z': setZoomOn(!zoomOn); hud.setZoom(zoomOn); break;
      case 'Escape': if (rig.zoomTarget > 1) rig.setZoom(1); else book?.lower(); break;
      default: return;
    }
    e.preventDefault();
  });
  // the wheel zooms toward the pointer (a lens ring, one click per notch); with zoom switched off it
  // turns the pages of an open book instead
  let wheelAt = 0;
  let zoomFocus: number | null = null;
  window.addEventListener('wheel', (e) => {
    if ((e.target as HTMLElement).closest?.('#controls, #book-toggle')) return;
    const book = reading();
    if (!zoomOn) {
      if (!book || Math.abs(e.deltaY) < 8) return;
      const now = performance.now();
      if (now - wheelAt < 420) return;
      wheelAt = now;
      if (e.deltaY > 0) book.next(); else book.prev();
      return;
    }
    e.preventDefault();
    sound.unlock();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    const from = rig.zoomTarget;
    const to = rig.setZoom(from * Math.exp(-dy * 0.0022), (e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    if (Math.abs(to - from) < 1e-3) return;
    sound.zoom(to, to > from);
    // focus on what's under the pointer: the book, an animal, or leave it to the torch
    if (to <= 1) zoomFocus = null;
    else if (!book) {
      const a = world.pick(e.clientX, e.clientY);
      if (a) zoomFocus = a.agent.pos.distanceTo(ocean.camera.position);
    }
  }, { passive: false });

  // ---------------------------------------------------------------- the loop
  loaderProgress(1, 'ready');
  ocean.render(0, 1 / 60); // warm up shaders before revealing
  setTimeout(() => {
    loaderDone();
    document.body.classList.add('ready');
    hud.setHeading(`${rig.heading} · ${rig.pitchLabel}`);
  }, 250);
  // the big visitors aren't due for a while: fetch them behind the scenes
  loadLate().then(() => world.buildScriptedPools());

  const aimAt = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const look = new THREE.Vector3();
  let simT = 0;
  let hinted = false;
  let lastBookState = '';
  /** one tick of everything; the dev helpers below call it directly to fast-forward */
  const step = (dt: number, render = true) => {
    simT += dt;
    const t = simT;
    ocean.fade = Math.min(1, t / INTRO);
    rig.update(dt, t);
    world.update(dt, t);
    portfolio.update(dt, ocean.camera);
    logBook.update(dt, ocean.camera);
    if (!hinted && t > INTRO + 1.5 && portfolio.state === 'rest') {
      hinted = true;
      // just under the book on screen
      look.copy(portfolio.root.position).project(ocean.camera);
      hud.showHint('click the book', (look.x + 1) / 2 * window.innerWidth, (1 - look.y) / 2 * window.innerHeight + 44);
    }
    const bookState = portfolio.state + portfolio.reading;
    if (bookState !== lastBookState) {
      lastBookState = bookState;
      hud.setBook(portfolio.inHand, portfolio.reading || portfolio.state === 'lifting' || portfolio.state === 'raising');
    }
    if (rig.zoomTarget <= 1 && rig.zoom < 1.02) zoomFocus = null;
    // the torch and the focus follow what the diver is looking at
    const book = reading();
    const hero = world.hero();
    ocean.camera.getWorldDirection(fwd);
    if (hero) aimAt.copy(hero.pos);
    else {
      // otherwise the diver lights whatever landmark is nearest the middle of the view
      let best = 0.9;
      aimAt.copy(ocean.camera.position).addScaledVector(fwd, 5).add(new THREE.Vector3(0, -0.8, 0));
      const cands = portfolio.state === 'rest' ? [portfolio.root.position, ...world.landmarks] : world.landmarks;
      for (const p of cands) {
        const d = look.copy(p).sub(ocean.camera.position).normalize().dot(fwd);
        if (d > best) { best = d; aimAt.copy(p); }
      }
    }
    aimTorch(ocean.torch, ocean.camera, hero ? hero.pos : null, aimAt, dt);
    // focus: the page when reading; what was zoomed on; far off when looking up at the surface; else the torch's target
    const ft = book ? book.heldDistance(ocean.camera)
      : zoomFocus ?? (!hero && rig.pitchStep >= 2 ? 9 : Math.max(0.8, ocean.camera.position.distanceTo(aimAt)));
    shared.focus.value += (ft - shared.focus.value) * Math.min(1, dt * 3);
    // a book held up close would be all blur at the water's aperture: stop down while reading
    const ap = book ? 0.02 : 0.22;
    shared.aperture.value += (ap - shared.aperture.value) * Math.min(1, dt * 4);
    if (render) ocean.render(t, dt);
  };
  let last = performance.now();
  const loop = () => {
    requestAnimationFrame(loop);
    const now = performance.now();
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (reduced) dt *= 0.35;
    step(dt);
  };
  loop();

  // expose for debugging in the console
  Object.assign(window as unknown as Record<string, unknown>, { ocean, world, rig, THREE, portfolio, logBook, field, sound });
  if (import.meta.env.DEV) {
    // dev helpers: fast-forward the simulation (the rAF loop pauses in hidden tabs), and render one
    // frame and save it through the vite shot plugin
    const w = window as unknown as { advance: (s: number) => number; shot: (name: string) => Promise<string> };
    w.advance = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 30); i++) step(1 / 30, false);
      return simT;
    };
    w.shot = async (name: string) => {
      step(1 / 60);
      const data = ocean.renderer.domElement.toDataURL('image/jpeg', 0.88);
      const r = await fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: data });
      return r.text();
    };
  }
}

boot();
