import * as THREE from 'three';
import { Ocean } from './scene/Ocean';
import { CameraRig } from './scene/CameraRig';
import { loadAll, loadLate, setupLoaders } from './scene/Assets';
import { World } from './sim/World';
import { SPECIES } from './sim/Species';
import { stage } from './scene/Terrain';
import { aimTorch, TORCH } from './scene/Environment';
import { shared } from './scene/UnderwaterMaterial';
import { sound } from './audio/Sound';
import { Book3D } from './book/Book3D';
import { portfolioPages } from './book/portfolio';
import { FieldLog } from './ui/fieldlog';
import { content } from './content';
import { Hud, loaderDone, loaderProgress, loaderReady, showFallback } from './ui/hud';
import { SectionMarks } from './ui/marks';

/**
 * The opening, in seconds from the "View portfolio" click (browsers won't play sound before one): a beat
 * of black as a drone and the diver's breathing swell up, then the torch clicks on and sweeps onto the book, and a
 * sea lion staring over the rock behind it. Nothing else moves until the book is picked up: then the
 * camera pulls back and daylight seeps down from above, and the controls appear once the camera settles.
 */
const TORCH_ON = 1.4;
/** the book can't be taken until the torch has flickered on and swept onto it */
const BOOK_READY = 2.5;
const DAY_TIME = 5.5;

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

  setupLoaders(ocean.renderer);
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
  const introEye = new THREE.Vector3();
  const layout = portfolioPages();
  const portfolio = new Book3D({
    width: 0.2, height: 0.28, thickness: 0.03, cover: 0xc23a2c, foil: '#d9b76a', leather,
    title: [content.fullName, 'Portfolio'], endpaper: '#6e2a22', inside: layout.inside,
  }, layout.pages);
  ocean.scene.add(portfolio.root);
  portfolio.onSound = (s) => sound.play(s);
  portfolio.renderer = ocean.renderer;
  // held in the diver's hands, sized to the unzoomed view
  portfolio.holder = rig.hands;
  portfolio.fitFov = rig.baseFov;
  const field = new FieldLog();
  {
    const s = stage();
    portfolio.placeAtRest(world.bookRest.pos, world.bookRest.up, s.fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.12));
    // the opening shot: close over the book on its rock, looking down at it, the diver's spot behind
    portfolio.root.updateMatrixWorld();
    const c = portfolio.restCentre;
    const back = new THREE.Vector3().subVectors(s.cam, c).setY(0).normalize();
    // low enough to see over the rock behind the book, where the sea lion comes to stare
    introEye.copy(c).addScaledVector(back, 0.5).add(new THREE.Vector3(0, 0.25, 0));
    rig.startIntro(introEye, c.clone().add(new THREE.Vector3(0, 0.07, 0)));
  }
  const reading = () => (portfolio.reading ? portfolio : null);
  // (declared with the loop below; the opening's clock, < 0 until "View portfolio")
  let diveT = -1;
  const bookLocked = () => portfolio.state === 'rest' && diveT < BOOK_READY;
  /** the book is up in front of the eye (rising, held, or being raised) */
  const bookUp = () => portfolio.state === 'lifting' || portfolio.state === 'held' || portfolio.state === 'raising';

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
    if (bookLocked()) return;
    sound.unlock();
    rig.setZoom(1);
    if (portfolio.state === 'rest') { field.close(); portfolio.pickUp(); }
    else if (portfolio.state === 'lowered' || portfolio.state === 'lowering') {
      field.close();
      leaveWatch();
      portfolio.raise();
    } else portfolio.lower();
  };
  const toggleLog = () => {
    sound.unlock();
    if (field.isOpen) { field.close(); return; }
    rig.setZoom(1);
    leaveWatch();
    // the book and the log are never open together
    portfolio.lower();
    field.open();
    sound.play('open');
  };
  field.onClose = () => sound.play('close');
  // the section buttons down the open book's right edge: one quick turn straight to a section
  let jumped: number | null = null; // the section last jumped to: highlighted while its page is in view
  const marks = new SectionMarks(layout.sections, portfolio, (i) => {
    sound.unlock();
    jumped = i;
    portfolio.resetZoom();
    portfolio.showPage(layout.sections[i].page, true);
  });
  // a phone held upright: one page at a time
  const fitLayout = () => { portfolio.onePage = window.innerWidth / window.innerHeight < 0.8; };
  fitLayout();
  window.addEventListener('resize', fitLayout);
  rig.onChange = () => hud.setHeading(`${rig.heading} · ${rig.pitchLabel}`);
  // orcas or the whale overhead: nudge the up arrow unless the diver is already looking up
  world.director.onLookUp = () => { if (rig.pitchStep < 1) hud.nudge('up'); };

  // pointer: click a page or a link, pick up the book, log an animal; drag to turn in steps. On a touch
  // screen a tap does what a click does, a swipe across the open book turns its pages, and two fingers
  // pinch to zoom (there's no wheel to do it with).
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const bookHit = (x: number, y: number) => {
    if (bookLocked()) return null;
    ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, ocean.camera);
    // (held, the targets are the exact page meshes: their gutter shading mustn't catch the ray)
    const hit = ray.intersectObjects(portfolio.targets(), portfolio.state === 'rest')[0];
    return hit ? { book: portfolio, hit } : null;
  };
  let zoomFocus: number | null = null; // (the distance to focus on while zoomed in on something)
  let down: { x: number; y: number; drag: boolean; turned: boolean; touch: boolean } | null = null;
  const fingers = new Map<number, { x: number; y: number }>();
  let pinch: { d0: number; z0: number; x: number; y: number; book: boolean } | null = null;
  const pinchState = () => {
    const [a, b] = [...fingers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') {
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size === 2 && !rig.inIntro) {
        // a second finger: the tap or swipe under way becomes a pinch
        const p = pinchState();
        const book = bookUp();
        pinch = { d0: Math.max(20, p.d), z0: book ? portfolio.zoomLevel : rig.zoomTarget, x: p.x, y: p.y, book };
        down = null;
        canvas.classList.remove('grab');
        return;
      }
      if (fingers.size > 2) return;
    }
    if (e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, drag: false, turned: false, touch: e.pointerType === 'touch' };
    // with a mouse a page turns as soon as it's pressed (links, and the book on its rock, wait for the
    // release); a finger waits to see whether it's a tap or a swipe
    if (down.touch) return;
    const h = bookHit(e.clientX, e.clientY);
    if (h && h.book.describe(h.hit)?.kind === 'turn') {
      sound.unlock();
      h.book.click(h.hit);
      down.turned = true;
    }
  });
  window.addEventListener('pointermove', (e) => {
    const f = fingers.get(e.pointerId);
    if (f) {
      f.x = e.clientX;
      f.y = e.clientY;
    }
    if (pinch && fingers.size >= 2) {
      const p = pinchState();
      const level = pinch.z0 * p.d / pinch.d0;
      const nx = (p.x / window.innerWidth) * 2 - 1;
      const ny = -(p.y / window.innerHeight) * 2 + 1;
      if (pinch.book) {
        const z0 = portfolio.zoomLevel;
        const z1 = portfolio.zoomAt(level, nx, ny, ocean.camera);
        // and two fingers carry the page along with them
        portfolio.panBy(((p.x - pinch.x) / window.innerWidth) * 2, (-(p.y - pinch.y) / window.innerHeight) * 2, ocean.camera);
        if (Math.floor(z1 * 4) !== Math.floor(z0 * 4)) sound.zoom(z1, z1 > z0);
      } else {
        const from = rig.zoomTarget;
        const to = rig.setZoom(level, nx, ny);
        if (Math.floor(to * 4) !== Math.floor(from * 4)) sound.zoom(to, to > from);
        const a = to > from ? world.pick(p.x, p.y) : null;
        if (a) zoomFocus = a.agent.pos.distanceTo(ocean.camera.position);
        if (to <= 1) zoomFocus = null;
      }
      pinch.x = p.x;
      pinch.y = p.y;
      return;
    }
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > (down.touch ? 10 : 14)) {
      down.drag = true;
      canvas.classList.add('grab');
    }
    if (!down && e.pointerType !== 'touch') {
      const h = bookHit(e.clientX, e.clientY);
      canvas.classList.toggle('pointer', !!(h && h.book.describe(h.hit)));
    }
  });
  const release = (e: PointerEvent) => {
    fingers.delete(e.pointerId);
    if (pinch) {
      // let go: a little zoom that's hardly any settles back to none
      if (fingers.size < 2) {
        if (pinch.book && portfolio.zoomLevel < 1.1) portfolio.resetZoom();
        if (!pinch.book && rig.zoomTarget < 1.1) rig.setZoom(1);
        pinch = null;
      }
      return;
    }
    if (!down || e.type === 'pointercancel') {
      down = null;
      canvas.classList.remove('grab');
      return;
    }
    const d = down;
    down = null;
    canvas.classList.remove('grab');
    if (d.drag) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      // a finger swiped across the open book turns its pages
      const book = reading();
      if (d.touch && book && Math.abs(dx) > Math.abs(dy)) {
        sound.unlock();
        if (dx < 0) book.next(); else book.prev();
        return;
      }
      // like grabbing the world: drag left to look right; roughly one step per 200 px (70 for a finger),
      // at most two
      const sx = THREE.MathUtils.clamp(Math.round(-dx / (d.touch ? 70 : 200)), -2, 2);
      const sy = THREE.MathUtils.clamp(Math.round(dy / (d.touch ? 60 : 160)), -2, 2);
      if (sx || sy) rig.step(sx, sy);
      return;
    }
    if (d.turned) return;
    sound.unlock();
    const h = bookHit(e.clientX, e.clientY);
    if (h) {
      h.book.click(h.hit);
      return;
    }
    // animals can't be logged during the opening (until the camera has pulled back and the controls are up),
    // or while the book or the field log is in the way
    if (rig.inIntro || bookUp() || field.isOpen) return;
    const a = world.pick(e.clientX, e.clientY);
    if (!a) return;
    const def = SPECIES[a.key];
    if (field.log(a.key, simT)) {
      sound.play('discover');
      hud.discover(a.key, def.name, def.latin, e.clientX, e.clientY, field.count, field.keys.length);
    } else hud.whisper(def.name, e.clientX, e.clientY);
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
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
      // (the log and the watch button are hidden until the opening is over)
      case 'l': case 'L': if (!rig.inIntro) toggleLog(); break;
      case 'h': case 'H': if (!rig.inIntro) hud.setWatch(!hud.isWatching); break;
      case 'z': case 'Z': setZoomOn(!zoomOn); hud.setZoom(zoomOn); break;
      case 'Escape':
        if (field.isOpen) field.close();
        else if (book && book.zoomLevel > 1.01) book.resetZoom();
        else if (rig.zoomTarget > 1) rig.setZoom(1);
        else book?.lower();
        break;
      default: return;
    }
    e.preventDefault();
  });
  // the wheel zooms toward the pointer (a lens ring, one click per notch); with zoom switched off it
  // turns the pages of an open book instead
  let wheelAt = 0;
  window.addEventListener('wheel', (e) => {
    if ((e.target as HTMLElement).closest?.('#controls, #book-toggle, #marks')) return;
    const book = reading();
    if (!zoomOn) {
      if (!book || Math.abs(e.deltaY) < 8) return;
      const now = performance.now();
      if (now - wheelAt < 280) return;
      wheelAt = now;
      if (e.deltaY > 0) book.next(); else book.prev();
      return;
    }
    e.preventDefault();
    sound.unlock();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = -(e.clientY / window.innerHeight) * 2 + 1;
    if (bookUp()) {
      // reading: bring the book closer along the pointer's line (the view doesn't turn, the page stays square)
      const z0 = portfolio.zoomLevel;
      const z1 = portfolio.zoomAt(z0 * Math.exp(-dy * 0.0022), nx, ny, ocean.camera);
      if (Math.abs(z1 - z0) > 1e-3) sound.zoom(z1, z1 > z0);
      return;
    }
    const from = rig.zoomTarget;
    const to = rig.setZoom(from * Math.exp(-dy * 0.0022), nx, ny);
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
  ocean.warmUp(); // shaders, GPU pipelines and textures for everything, before revealing
  // the visit starts on "View portfolio": that click also unlocks the sound, so the opening can start with it
  const begin = () => {
    if (diveT >= 0) return;
    sound.unlock();
    void sound.ready.then(() => sound.opener());
    diveT = 0;
    world.director.opener(introEye);
    loaderDone();
  };
  loaderReady(begin);
  // the controls stay hidden through the opening, until the camera has pulled back to the diver's spot
  rig.onIntroDone = () => {
    document.body.classList.add('ready');
    hud.setHeading(`${rig.heading} · ${rig.pitchLabel}`);
  };
  // the big visitors aren't due for a while: fetch them behind the scenes
  loadLate().then(() => world.buildScriptedPools());

  const aimAt = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const look = new THREE.Vector3();
  let simT = 0;
  let lastBookState = '';
  let torchLit = false;
  let dayT = -1; // seconds since the book was picked up (the daylight comes up from there)
  /** one tick of everything; the dev helpers below call it directly to fast-forward */
  const step = (dt: number, render = true) => {
    if (diveT < 0) {
      // waiting for the click: black
      ocean.fade = 0;
      if (render) ocean.render(simT, dt);
      return;
    }
    simT += dt;
    diveT += dt;
    const t = simT;
    ocean.fade = Math.min(1, diveT / 0.3);
    // the torch: off in the black, then a click and a couple of flickers, pointed off to one side so it
    // sweeps across onto the book
    if (!torchLit && diveT >= TORCH_ON) {
      torchLit = true;
      sound.torchClick();
      TORCH.dir.set(0.55, 0.4, -1).normalize();
    }
    const tt = diveT - TORCH_ON;
    ocean.torchOn = tt < 0 ? 0 : tt < 0.06 ? 1 : tt < 0.14 ? 0.15 : tt < 0.2 ? 0.9 : tt < 0.26 ? 0.35 : 1;
    // daylight seeps down from above once the book has been picked up
    if (dayT >= 0) dayT += dt;
    const day = THREE.MathUtils.smoothstep(dayT, 0, DAY_TIME);
    ocean.daylight = day * day * (0.6 + 0.4 * day);
    rig.update(dt, t);
    // (the animals' level of detail is chosen for the zoom being headed for, so zooming in never catches up with it)
    world.viewPx = ocean.renderer.domElement.height;
    world.zoomAhead = Math.max(1, rig.zoomTarget / rig.zoom);
    world.update(dt, t);
    portfolio.update(dt, ocean.camera);
    // the opening shot ends when the book is picked up: the camera pulls back as it rises into the hands,
    // and the sea lion that was watching bolts
    if (rig.inIntro && portfolio.state !== 'rest' && dayT < 0) {
      dayT = 0;
      rig.releaseIntro();
      world.director.openerBolt();
    }
    if (bookUp() && rig.zoomTarget > 1) rig.setZoom(1);
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
      const cands = portfolio.state === 'rest' ? [portfolio.restCentre, ...world.landmarks] : world.landmarks;
      for (const p of cands) {
        const d = look.copy(p).sub(ocean.camera.position).normalize().dot(fwd);
        if (d > best) { best = d; aimAt.copy(p); }
      }
    }
    // on the opening shot the torch stays on the book, whatever else turns up
    if (rig.inIntro && portfolio.state === 'rest') aimTorch(ocean.torch, ocean.camera, portfolio.restCentre, aimAt, dt);
    else aimTorch(ocean.torch, ocean.camera, hero ? hero.pos : null, aimAt, dt);
    // focus: the page when reading; what was zoomed on; far off when looking up at the surface; else the torch's target
    const ft = book ? book.heldDistance(ocean.camera)
      : rig.inIntro && portfolio.state === 'rest' ? ocean.camera.position.distanceTo(portfolio.restCentre)
      : zoomFocus ?? (!hero && rig.pitchStep >= 2 ? 9 : Math.max(0.8, ocean.camera.position.distanceTo(aimAt)));
    shared.focus.value += (ft - shared.focus.value) * Math.min(1, dt * (rig.inIntro ? 8 : 3));
    // close over the book the torch is turned down, then comes up as the camera pulls back
    const ts = rig.inIntro ? THREE.MathUtils.clamp(ocean.camera.position.distanceTo(portfolio.restCentre ?? aimAt) / 2.2, 0.28, 1) : 1;
    ocean.torchScale += (ts - ocean.torchScale) * Math.min(1, dt * 2);
    // the book in the diver's hands is never blurred (from the first frame of the lift); the water behind
    // it keeps its depth of field. The dome-port distortion eases off so lines of type stay straight.
    const up = bookUp() || portfolio.state === 'lowering';
    // On the opening shot, everything as far back as the sea lion staring over the rock is sharp too.
    const seal = rig.inIntro && portfolio.state === 'rest' ? world.director.openerSeal : null;
    ocean.sharpNear = up ? ocean.camera.position.distanceTo(portfolio.root.position) + 0.4
      : seal ? ocean.camera.position.distanceTo(seal.pos) + 0.35 : 0;
    // the bubbles catch the torch in the dark, the daylight later
    world.bubbles.light = Math.max(ocean.torchOn * 0.9, ocean.daylight);
    ocean.barrel += ((bookUp() ? 0 : 1) - ocean.barrel) * Math.min(1, dt * 6);
    if (render) ocean.render(t, dt);
    // the section buttons, beside the open book (not one page at a time: there's no room beside the page).
    // The one highlighted is the section the left-hand page is in, or one just jumped to while it's in view.
    let active = 0;
    const leftPage = 2 * portfolio.spread - 1;
    layout.sections.forEach((sec, i) => { if (sec.page <= leftPage) active = i; });
    if (jumped !== null) {
      if (portfolio.spreadOf(layout.sections[jumped].page) === portfolio.spread) active = jumped;
      else if (!portfolio.busy) jumped = null;
    }
    if (render) marks.update(portfolio.reading && !portfolio.onePage && !rig.inIntro, active, ocean.camera);
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
  Object.assign(window as unknown as Record<string, unknown>, { ocean, world, rig, THREE, portfolio, field, sound, marks });
  if (import.meta.env.DEV) {
    // dev helpers: fast-forward the simulation (the rAF loop pauses in hidden tabs), and render one
    // frame and save it through the vite shot plugin
    (window as unknown as { begin: () => void }).begin = begin;
    const w = window as unknown as { advance: (s: number) => number; shot: (name: string) => Promise<string> };
    w.advance = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 30); i++) step(1 / 30, false);
      return simT;
    };
    if (new URLSearchParams(location.search).has('bench')) void import('./dev/bench').then((m) => m.run());
    w.shot = async (name: string) => {
      step(1 / 60);
      const data = ocean.renderer.domElement.toDataURL('image/jpeg', 0.88);
      const r = await fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: data });
      return r.text();
    };
  }
}

boot();
