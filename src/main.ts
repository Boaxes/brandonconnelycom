import * as THREE from 'three';
import { Ocean } from './scene/Ocean';
import { CameraRig } from './scene/CameraRig';
import { loadAll } from './scene/Assets';
import { buildUI, loaderDone, loaderProgress, showFallback } from './ui/overlay';
import { World } from './sim/World';
import { Ambience } from './audio/Ambience';
import { marginYaw, stageWater, WORLD } from './scene/Terrain';
import { aimTorch } from './scene/Environment';
import { shared } from './scene/UnderwaterMaterial';

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
    showFallback('Your browser could not start WebGL, so the water is switched off. The portfolio still works.');
    buildUI({ onWatch: () => {}, onAudio: () => {} });
    return;
  }

  loaderProgress(0.02, 'loading the Sound…');
  try {
    await loadAll((p) => loaderProgress(0.05 + p * 0.75, 'loading creatures…'));
  } catch (e) {
    console.error(e);
    loaderProgress(1, 'could not load models');
  }

  const rig = new CameraRig(ocean.camera);
  const world = new World(ocean.scene, ocean.camera);
  loaderProgress(0.9, 'waking everything up…');
  world.populate();

  const ambience = new Ambience();
  // the scene isn't drawn behind the notebook page (unless it's put away to watch the water)
  let watching = false;
  const updateMask = () => {
    const page = document.getElementById('content');
    if (!page || watching) return ocean.setMask(0, 0);
    const r = page.getBoundingClientRect();
    ocean.setMask(r.left, r.right);
  };
  const ui = buildUI({
    onWatch: (on) => {
      world.watchMode = on;
      watching = on;
      // let the page slide away before the scene behind it is drawn, and draw it before it slides back
      if (on) updateMask();
      else setTimeout(updateMask, 450);
    },
    onAudio: (on) => (on ? ambience.start() : ambience.stop()),
  });
  window.addEventListener('resize', updateMask);
  updateMask();

  // with nothing to watch, the torch drifts between the two strips of scene beside the page
  const sweep = new THREE.Vector3();
  const sweepAt = (t: number) => {
    const m = marginYaw();
    const k = THREE.MathUtils.clamp(Math.sin(t * 0.21 + 1.2) * 1.8, -1, 1);
    return stageWater(k * (m.inner + m.outer) / 2, 5, 0.3, sweep);
  };

  // warm up shaders with one render before revealing
  ocean.render(0, 1 / 60);
  loaderProgress(1, 'ready');
  setTimeout(loaderDone, 250);

  let last = performance.now();
  let hudTimer = 0;
  let simT = 0;
  /** one tick of everything; the dev helpers below call it directly to fast-forward */
  const step = (dt: number, render = true) => {
    simT += dt;
    const t = simT;
    rig.update(dt, t);
    world.update(dt, t);
    // the torch and the focus follow what the diver is watching
    const hero = world.hero();
    aimTorch(ocean.torch, ocean.camera, hero ? hero.pos : null, sweepAt(t), dt);
    const ft = Math.max(0.8, ocean.camera.position.distanceTo(hero ? hero.pos : sweep));
    shared.focus.value += (ft - shared.focus.value) * Math.min(1, dt * 2.2);
    if (!render) return;
    ambience.update(ocean.camera.position.y / WORLD.surfaceY, world.nearestLargeAnimal(ocean.camera.position));
    ocean.render(t, dt);

    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      while (world.observed.length) ui.markObserved(world.observed.shift()!);
      const depth = WORLD.surfaceY - ocean.camera.position.y;
      ui.setHud({
        depth,
        temp: 9.6 - depth * 0.04 + Math.sin(t * 0.05) * 0.15,
        light: Math.exp(-depth * 0.09),
        count: world.visibleCount,
        time: t,
      });
    }
  };
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
  (window as unknown as { ocean: Ocean; world: World; THREE: typeof THREE }).ocean = ocean;
  (window as unknown as { world: World }).world = world;
  (window as unknown as { rig: CameraRig }).rig = rig;
  (window as unknown as { THREE: typeof THREE }).THREE = THREE;
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
      // composite a paper-coloured block where the page is, to judge the framing as a visitor sees it
      const src = ocean.renderer.domElement;
      const c2 = document.createElement('canvas');
      c2.width = src.width;
      c2.height = src.height;
      const g = c2.getContext('2d')!;
      g.drawImage(src, 0, 0);
      const page = document.getElementById('content');
      if (page && !world.watchMode) {
        const r = page.getBoundingClientRect();
        const k = src.width / window.innerWidth;
        g.fillStyle = '#efe8d6';
        g.fillRect(r.left * k, 0, r.width * k, src.height);
      }
      const data = c2.toDataURL('image/jpeg', 0.88);
      const r = await fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: data });
      return r.text();
    };
  }
}

boot();
