import * as THREE from 'three';
import { Ocean } from './scene/Ocean';
import { CameraRig } from './scene/CameraRig';
import { loadAll } from './scene/Assets';
import { buildUI, loaderDone, loaderProgress, showFallback } from './ui/overlay';
import { World } from './sim/World';
import { Ambience } from './audio/Ambience';
import { WORLD } from './scene/Terrain';

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
  const ui = buildUI({
    onWatch: (on) => {
      world.watchMode = on;
    },
    onAudio: (on) => (on ? ambience.start() : ambience.stop()),
  });

  const onScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    rig.setScroll(max > 0 ? window.scrollY / max : 0);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // warm up shaders with one render before revealing
  ocean.render(0, 1 / 60);
  loaderProgress(1, 'ready');
  setTimeout(loaderDone, 250);

  let last = performance.now();
  let hudTimer = 0;
  const loop = () => {
    requestAnimationFrame(loop);
    const now = performance.now();
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (reduced) dt *= 0.35;
    const t = ocean.clock.getElapsedTime();
    rig.update(dt, t);
    world.update(dt, t);
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
  loop();

  // expose for debugging in the console
  (window as unknown as { ocean: Ocean; world: World; THREE: typeof THREE }).ocean = ocean;
  (window as unknown as { world: World }).world = world;
  (window as unknown as { rig: CameraRig }).rig = rig;
  (window as unknown as { THREE: typeof THREE }).THREE = THREE;
  if (import.meta.env.DEV) {
    // dev helper: render one frame and save it through the vite shot plugin
    (window as unknown as { shot: (name: string) => Promise<string> }).shot = async (name: string) => {
      const t = ocean.clock.getElapsedTime();
      rig.update(1 / 60, t);
      world.update(1 / 60, t);
      ocean.render(t, 1 / 60);
      const data = ocean.renderer.domElement.toDataURL('image/jpeg', 0.88);
      const r = await fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: data });
      return r.text();
    };
  }
}

boot();
