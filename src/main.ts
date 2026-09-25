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
    new Hud({ book() {}, log() {}, look() {}, ambience() {}, sfx() {}, watch() {} }, { ambience: false, sfx: false });
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
    title: [content.fullName, 'Portfolio', content.title], endpaper: '#6e2a22', distance: 0.5,
  }, portfolioPages());
  const field = new FieldLog();
  const logBook = new Book3D({
    width: 0.15, height: 0.21, thickness: 0.016, cover: 0x6a7a55, foil: '#e7dcb8', leather,
    title: ['Field log', 'Puget Sound', '30 ft'], endpaper: '#3b4633', distance: 0.38,
  }, field.pages);
  ocean.scene.add(portfolio.root, logBook.root);
  logBook.root.visible = false;
  portfolio.onSound = logBook.onSound = (s) => sound.play(s);
  {
    const s = stage();
    portfolio.placeAtRest(world.bookRest.pos, world.bookRest.up, s.fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.12));
  }
  const reading = () => (portfolio.reading ? portfolio : logBook.reading ? logBook : null);

  // ---------------------------------------------------------------- controls
  let quietWatch = false; // set while syncing the watch button without side effects
  const hud = new Hud({
    book: () => toggleBook(),
    log: () => toggleLog(),
    look: (y, p) => rig.step(y, p),
    ambience: (on) => { sound.unlock(); sound.setAmbience(on); },
    sfx: (on) => { sound.unlock(); sound.setSfx(on); },
    watch: (on) => {
      if (quietWatch) return;
      if (on) {
        portfolio.lower();
        logBook.lower();
      } else if (portfolio.inHand) portfolio.raise();
    },
  }, { ambience: sound.ambienceOn, sfx: sound.sfxOn });
  hud.setCount(field.count);
  const leaveWatch = () => {
    if (!hud.isWatching) return;
    quietWatch = true;
    hud.setWatch(false);
    quietWatch = false;
  };
  const toggleBook = () => {
    sound.unlock();
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
    if (logBook.state === 'lowered' || logBook.state === 'lowering') {
      portfolio.lower();
      leaveWatch();
      field.render();
      logBook.refresh();
      logBook.raise();
    } else logBook.lower();
  };
  rig.onChange = () => hud.setHeading(`${rig.heading} · ${rig.pitchLabel}`);

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
      case 'Escape': book?.lower(); break;
      default: return;
    }
    e.preventDefault();
  });
  let wheelAt = 0;
  window.addEventListener('wheel', (e) => {
    const book = reading();
    if (!book || Math.abs(e.deltaY) < 8) return;
    const now = performance.now();
    if (now - wheelAt < 420) return;
    wheelAt = now;
    if (e.deltaY > 0) book.next(); else book.prev();
  }, { passive: true });

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
  let simT = 0;
  let hinted = false;
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
      hud.showHint('click the book');
    }
    // the torch and the focus follow what the diver is looking at
    const book = reading();
    const hero = world.hero();
    ocean.camera.getWorldDirection(fwd);
    if (hero) aimAt.copy(hero.pos);
    else if (portfolio.state === 'rest' && fwd.dot(aimAt.copy(portfolio.root.position).sub(ocean.camera.position).normalize()) > 0.8) aimAt.copy(portfolio.root.position);
    else aimAt.copy(ocean.camera.position).addScaledVector(fwd, 5).add(new THREE.Vector3(0, -0.8, 0));
    aimTorch(ocean.torch, ocean.camera, hero ? hero.pos : null, aimAt, dt);
    const ft = book ? (book === portfolio ? 0.5 : 0.38) : Math.max(0.8, ocean.camera.position.distanceTo(aimAt));
    shared.focus.value += (ft - shared.focus.value) * Math.min(1, dt * 3);
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
