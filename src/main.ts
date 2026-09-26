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
import { FieldLog } from './ui/fieldlog';
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
  const book = portfolioPages();
  const portfolio = new Book3D({
    width: 0.2, height: 0.28, thickness: 0.03, cover: 0xc23a2c, foil: '#d9b76a', leather,
    title: [content.fullName, 'Portfolio', content.title], endpaper: '#6e2a22',
    tabs: book.sections.map((s) => ({ label: s.tab, page: s.page })),
  }, book.pages);
  // picked up, the book is drawn in the overlay: square to the eye, sharp, over the water effects
  portfolio.overlay = { scene: ocean.overlay, camera: ocean.overlayCam };
  ocean.scene.add(portfolio.root);
  portfolio.onSound = (s) => sound.play(s);
  const field = new FieldLog();
  {
    const s = stage();
    portfolio.placeAtRest(world.bookRest.pos, world.bookRest.up, s.fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.12));
    // the opening shot: close over the book on its rock, looking down at it, the diver's spot behind
    portfolio.root.updateMatrixWorld();
    const c = portfolio.restCentre;
    const back = new THREE.Vector3().subVectors(s.cam, c).setY(0).normalize();
    rig.startIntro(c.clone().addScaledVector(back, 0.36).add(new THREE.Vector3(0, 0.36, 0)), c.clone().add(new THREE.Vector3(0, 0.02, 0)));
  }
  const reading = () => (portfolio.reading ? portfolio : null);

  // ---------------------------------------------------------------- controls
  // scroll-to-zoom starts on; nothing (zoom, sound, the field log) is remembered between visits
  let zoomOn = true;
  const setZoomOn = (on: boolean) => {
    zoomOn = on;
    if (!on) rig.setZoom(1);
  };
  // browsers keep audio locked until a click or key press: the first one anywhere starts the water
  for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) window.addEventListener(ev, () => sound.unlock(), { capture: true, passive: true });
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
        field.close();
        rig.releaseIntro();
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
    if (portfolio.state === 'rest') portfolio.pickUp(ocean.camera);
    else if (portfolio.state === 'lowered' || portfolio.state === 'lowering') {
      field.close();
      leaveWatch();
      portfolio.raise();
    } else {
      portfolio.lower();
      // putting the book down the first time: the camera pulls back and the dive opens up
      rig.releaseIntro();
    }
  };
  const toggleLog = () => {
    sound.unlock();
    if (field.isOpen) { field.close(); return; }
    rig.setZoom(1);
    leaveWatch();
    field.open();
    sound.play('open');
  };
  field.onClose = () => sound.play('close');
  rig.onChange = () => hud.setHeading(`${rig.heading} · ${rig.pitchLabel}`);
  // orcas or the whale overhead: nudge the up arrow unless the diver is already looking up
  world.director.onLookUp = () => { if (rig.pitchStep < 1) hud.nudge('up'); };

  // pointer: click a page or a link, pick up the book, log an animal; drag to turn in steps
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const bookHit = (x: number, y: number) => {
    ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    // held, the book is in the overlay and seen through its camera; resting, through the diver's
    ray.setFromCamera(ndc, portfolio.inOverlay ? ocean.overlayCam : ocean.camera);
    // (held, the targets are the exact page and tab meshes: their shading overlays mustn't catch the ray)
    const hit = ray.intersectObjects(portfolio.targets(), portfolio.state === 'rest')[0];
    return hit ? { book: portfolio, hit } : null;
  };
  let down: { x: number; y: number; lx: number; ly: number; drag: boolean; pan: boolean } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // reading a zoomed page, a drag moves the page; otherwise it turns the view
    down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, drag: false, pan: portfolio.reading && portfolio.zoomLevel > 1.01 };
  });
  window.addEventListener('pointermove', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) {
      down.drag = true;
      canvas.classList.add('grab');
    }
    if (down?.drag && down.pan) {
      portfolio.pan(e.clientX - down.lx, e.clientY - down.ly);
      down.lx = e.clientX;
      down.ly = e.clientY;
    }
    if (!down) {
      const h = bookHit(e.clientX, e.clientY);
      const d = h ? h.book.describe(h.hit) : null;
      canvas.classList.toggle('pointer', !!d);
      // near the outer edge of a page, its corner lifts a little: it can be turned
      portfolio.hover(d && d.kind === 'turn' && d.edge ? d.dir : 0);
    }
  });
  window.addEventListener('pointerup', (e) => {
    if (!down) return;
    const d = down;
    down = null;
    canvas.classList.remove('grab');
    if (d.drag && d.pan) return;
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
      h.book.click(h.hit, ocean.camera);
      return;
    }
    const a = world.pick(e.clientX, e.clientY);
    if (!a) return;
    const def = SPECIES[a.key];
    if (field.log(a.key, simT)) {
      sound.play('discover');
      hud.discover(a.key, def.name, def.latin, e.clientX, e.clientY, field.count, field.keys.length);
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
      case 'Escape':
        if (field.isOpen) field.close();
        else if (book && book.zoomLevel > 1.01) book.resetView();
        else if (rig.zoomTarget > 1) rig.setZoom(1);
        else if (book) { book.lower(); rig.releaseIntro(); }
        break;
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
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = -(e.clientY / window.innerHeight) * 2 + 1;
    if (book) {
      // reading: magnify the page under the pointer, like a PDF viewer
      const z0 = book.zoomLevel;
      const z1 = book.zoomAt(z0 * Math.exp(-dy * 0.0022), nx, ny);
      if (Math.abs(z1 - z0) > 1e-3) sound.zoom(z1, z1 > z0);
      return;
    }
    const from = rig.zoomTarget;
    const to = rig.setZoom(from * Math.exp(-dy * 0.0022), nx, ny);
    if (Math.abs(to - from) < 1e-3) return;
    sound.zoom(to, to > from);
    // focus on what's under the pointer: the book, an animal, or leave it to the torch
    if (to <= 1) zoomFocus = null;
    else {
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
  let lastBookState = '';
  /** one tick of everything; the dev helpers below call it directly to fast-forward */
  const step = (dt: number, render = true) => {
    simT += dt;
    const t = simT;
    ocean.fade = Math.min(1, t / INTRO);
    rig.update(dt, t);
    world.update(dt, t);
    portfolio.update(dt);
    // the water dims behind the book while it's up
    const up = portfolio.inOverlay && portfolio.state !== 'lowered' && portfolio.state !== 'lowering' ? 1 : 0;
    ocean.veilAmount += (up - ocean.veilAmount) * Math.min(1, dt * 4);
    const bookState = portfolio.state + portfolio.reading;
    if (bookState !== lastBookState) {
      lastBookState = bookState;
      hud.setBook(portfolio.inHand, portfolio.reading || portfolio.state === 'lifting' || portfolio.state === 'raising');
    }
    if (rig.zoomTarget <= 1 && rig.zoom < 1.02) zoomFocus = null;
    // the torch and the focus follow what the diver is looking at
    const hero = world.hero();
    ocean.camera.getWorldDirection(fwd);
    if (hero) aimAt.copy(hero.pos);
    else {
      // otherwise the diver lights whatever landmark is nearest the middle of the view
      let best = 0.9;
      aimAt.copy(ocean.camera.position).addScaledVector(fwd, 5).add(new THREE.Vector3(0, -0.8, 0));
      const cands = portfolio.state === 'rest' ? [portfolio.restCentre, ...world.landmarks] : world.landmarks;
      for (const p of cands) {
        const d = look.copy(p).sub(ocean.camera.position).normalize().dot(fwd);
        if (d > best) { best = d; aimAt.copy(p); }
      }
    }
    aimTorch(ocean.torch, ocean.camera, hero ? hero.pos : null, aimAt, dt);
    // focus: the page when reading; what was zoomed on; far off when looking up at the surface; else the torch's target
    // (the held book is drawn separately and always sharp; behind it the water stays softly focused)
    const ft = rig.inIntro && portfolio.state === 'rest' ? ocean.camera.position.distanceTo(portfolio.restCentre)
      : zoomFocus ?? (!hero && rig.pitchStep >= 2 ? 9 : Math.max(0.8, ocean.camera.position.distanceTo(aimAt)));
    shared.focus.value += (ft - shared.focus.value) * Math.min(1, dt * (rig.inIntro ? 8 : 3));
    // close over the book the torch is turned down, then comes up as the camera pulls back
    const ts = rig.inIntro ? THREE.MathUtils.clamp(ocean.camera.position.distanceTo(portfolio.restCentre ?? aimAt) / 2.2, 0.28, 1) : 1;
    ocean.torchScale += (ts - ocean.torchScale) * Math.min(1, dt * 2);
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
  Object.assign(window as unknown as Record<string, unknown>, { ocean, world, rig, THREE, portfolio, field, sound });
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
