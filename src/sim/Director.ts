import * as THREE from 'three';
import type { Agent } from './Agent';
import { BenthicFish, type Leg, type Scripted } from './behaviors';
import { marginYaw, stage, stageFloor, stageWater } from '../scene/Terrain';
import type { World } from './World';

/**
 * Stages the visits. The first minute is scripted, because that's what a visitor actually sees:
 *   ~3 s   a rockfish drifts over to look at the camera
 *   ~6 s   the octopus creeps in at the edge of the right-hand strip and settles by its boulder
 *   ~15 s  a harbor seal comes out of the murk, hangs in front of the lens for a good look, circles, leaves
 *   ~40 s  orcas pass as dark shapes at the limit of visibility
 * After that, visits are drawn at random (with cooldowns) from the same repertoire plus a few more.
 * Routes are camera-relative (yaw, distance, height) so they land in the strips beside the page.
 */
export class Director {
  t = 0;
  /** the animal the diver is paying attention to: the torch and focus follow it */
  hero: Agent | null = null;
  private queue: { at: number; run: () => void }[] = [];
  private last: Record<string, number> = {};
  private nextRandom = 64;
  private octopusHome = new THREE.Vector3();

  constructor(private w: World) {
    this.at(3, () => this.rockfishHello());
    this.at(6, () => this.octopusArrives());
    this.at(15, () => this.sealVisit(-1));
    this.at(40, () => this.orcaPass(1));
  }

  private at(t: number, run: () => void) {
    this.queue.push({ at: t, run });
    this.queue.sort((a, b) => a.at - b.at);
  }

  update(dt: number) {
    this.t += dt;
    while (this.queue.length && this.queue[0].at <= this.t) this.queue.shift()!.run();
    if (this.hero && (!this.hero.alive || (this.hero as Scripted).done)) this.hero = null;
    if (this.hero instanceof BenthicFish && this.hero.state !== 'inspect') this.hero = null;

    if (this.t > this.nextRandom) {
      this.nextRandom = this.t + 18 + Math.random() * 22;
      this.randomVisit();
    }
  }

  private randomVisit() {
    const side = Math.random() < 0.5 ? -1 : 1;
    const menu: [string, number, number, () => boolean][] = [
      // name, weight, cooldown (s), run
      ['seal', 3, 70, () => this.sealVisit(side)],
      ['herring', 2, 45, () => this.herringSweep(side)],
      ['rockfish', 2, 30, () => this.rockfishHello()],
      ['porpoise', 1.4, 100, () => this.porpoisePass(side)],
      ['salmon', 1, 90, () => this.salmonPass(side)],
      ['octopus', 1, 120, () => this.octopusWander()],
      ['orca', 1, 200, () => this.orcaPass(side)],
      ['humpback', 0.6, 360, () => this.t > 150 && this.humpbackPass(side)],
    ];
    const ok = menu.filter(([k, , cd]) => this.t - (this.last[k] ?? -1e9) > cd);
    let r = Math.random() * ok.reduce((s, m) => s + m[1], 0);
    for (const [k, wgt, , run] of ok) {
      r -= wgt;
      if (r <= 0) {
        if (run()) this.last[k] = this.t;
        return;
      }
    }
  }

  // ---------------------------------------------------------------- repertoire

  /** yaw at fraction `f` across the strip on `side` (-1 left, 1 right); f < 0 or > 1 runs past it */
  private band(side: number, f: number) {
    const m = marginYaw();
    return side * (m.inner + (m.outer - m.inner) * f);
  }

  private rockfishHello(): boolean {
    const cam = stage().cam;
    const fish: BenthicFish[] = [];
    for (const key of ['rockfish', 'blackrockfish']) {
      for (const a of this.w.pops.get(key)?.agents ?? []) if (a instanceof BenthicFish && a.alive && a.state === 'cruise') fish.push(a);
    }
    fish.sort((a, b) => a.pos.distanceTo(cam) - b.pos.distanceTo(cam));
    const f = fish.find((a) => a.comeLook());
    if (!f) return false;
    if (!this.hero) this.hero = f;
    return true;
  }

  /** A harbor seal comes in from the murk, hangs in front of the lens, circles, then loses interest. */
  private sealVisit(side: number): boolean {
    const s = this.w.scripted('seal');
    if (!s) return false;
    const H = stage().height;
    const cam = stage().cam;
    const b = (f: number) => this.band(side, f);
    const legs: Leg[] = [
      { to: stageWater(b(0.5), 6, H + 0.5), speed: 1.8, doing: 'gliding in from the murk' },
      { to: stageWater(b(0.72), 3.0, H - 0.3), speed: 1.1, hold: 5, face: cam, doing: 'having a good look at you' },
      { to: stageWater(b(0.95), 3.4, H + 0.4), speed: 1.0, doing: 'circling for a better look' },
      { to: stageWater(b(0.6), 3.9, H + 0.1), speed: 1.0, hold: 2.2, face: cam, doing: 'watching you, whiskers forward' },
      { to: stageWater(-b(0.6), 6.5, H + 1.6), speed: 2.3, doing: 'losing interest' },
      { to: stageWater(-b(1.6), 15, H + 3), speed: 3, doing: 'heading off to hunt' },
    ];
    s.start(stageWater(b(0.55), 15, H + 1.4), legs);
    this.hero = s;
    return true;
  }

  /** Orcas pass across the frame as dark shapes at the edge of visibility. */
  private orcaPass(dir: number): boolean {
    const n = 3;
    let started = 0;
    for (let i = 0; i < n; i++) {
      const o = this.w.scripted('orca');
      if (!o) break;
      const dist = 8 + i * 1.4;
      const h = 3.2 + i * 0.5;
      // claim now, start staggered: park it far off-frame until its turn
      o.start(stageWater(this.band(dir, 1.9), 22, h), []);
      o.done = false;
      o.alive = false;
      this.at(this.t + i * 2.4, () => {
        o.start(stageWater(this.band(dir, 1.8), 16, h), [
          { to: stageWater(this.band(dir, 0.9), dist, h), speed: 2.6, doing: 'travelling with the pod' },
          { to: stageWater(this.band(-dir, 0.9), dist, h), speed: 2.6, doing: 'travelling with the pod' },
          { to: stageWater(this.band(-dir, 1.9), 18, h + 1), speed: 3, doing: 'travelling with the pod' },
        ]);
        if (i === 0) this.hero = o;
      });
      started++;
    }
    return started > 0;
  }

  private porpoisePass(dir: number): boolean {
    let started = 0;
    for (let i = 0; i < 2; i++) {
      const p = this.w.scripted('porpoise');
      if (!p) break;
      const dist = 5.5 + i * 0.9;
      const h = 2.4 + i * 0.4;
      p.start(stageWater(this.band(-dir, 1.8), 14, h), [
        { to: stageWater(this.band(-dir, 0.7), dist, h), speed: 3.3, doing: 'passing through fast' },
        { to: stageWater(this.band(dir, 0.7), dist, h + 0.3), speed: 3.3, doing: 'passing through fast' },
        { to: stageWater(this.band(dir, 1.9), 16, h + 1), speed: 3.6, doing: 'gone as quickly as it came' },
      ]);
      if (i === 0) this.hero = p;
      started++;
    }
    return started > 0;
  }

  private humpbackPass(dir: number): boolean {
    const hb = this.w.scripted('humpback');
    if (!hb) return false;
    hb.start(stageWater(this.band(dir, 2.2), 24, 5.5), [
      { to: stageWater(this.band(dir, 0.8), 12.5, 5), speed: 1.6, doing: 'passing through, huge and unhurried' },
      { to: stageWater(this.band(-dir, 0.8), 12.5, 5), speed: 1.6, doing: 'passing through, huge and unhurried' },
      { to: stageWater(this.band(-dir, 2.2), 24, 6), speed: 1.8, doing: 'fading into the murk' },
    ]);
    this.hero = hb;
    return true;
  }

  /** The herring school sweeps through the frame in front of the camera and on out. */
  private herringSweep(dir: number): boolean {
    const sc = this.w.school('herring');
    if (!sc) return false;
    sc.route = [
      stageWater(this.band(dir, 1.6), 12, 3.2),
      stageWater(this.band(dir, 0.6), 5.5, 2.4),
      stageWater(this.band(-dir, 0.6), 6, 2.8),
      stageWater(this.band(-dir, 1.8), 14, 3.4),
    ];
    sc.routeSpeed = 1.8;
    return true;
  }

  private salmonPass(dir: number): boolean {
    const sc = this.w.school('chinook');
    if (!sc) return false;
    sc.route = [
      stageWater(this.band(dir, 1.6), 13, 3.5),
      stageWater(this.band(dir, 0.5), 7, 3),
      stageWater(this.band(-dir, 0.5), 7.5, 3.4),
      stageWater(this.band(-dir, 1.8), 15, 4),
    ];
    sc.routeSpeed = 1.6;
    return true;
  }

  /** The octopus creeps in from past the right edge and settles against its boulder, and stays. */
  private octopusArrives(): boolean {
    const o = this.w.scripted('octopus');
    if (!o) return false;
    this.octopusHome.copy(this.w.den);
    o.start(stageFloor(this.band(1, 1.35), 7.2), [
      { to: stageFloor(this.band(1, 0.85), 6.2), speed: 0.14, doing: 'creeping between the boulders' },
      { to: this.octopusHome.clone(), speed: 0.1, hold: 1e9, doing: 'tucked against a boulder, watching', radius: 0.25 },
    ]);
    return true;
  }

  /** Later on, the octopus takes a short walk and comes back. */
  private octopusWander(): boolean {
    const p = this.w.pops.get('octopus');
    const o = p?.agents[0] as Scripted | undefined;
    if (!o || !o.alive) return this.octopusArrives();
    const away = stageFloor(this.band(1, 0.2 + Math.random() * 0.5), 4.5 + Math.random() * 2.5);
    o.setLegs([
      { to: away, speed: 0.12, doing: 'out foraging, feeling under the shells', radius: 0.25 },
      { to: away.clone(), speed: 0.1, hold: 8 + Math.random() * 8, doing: 'probing a crevice with one arm', radius: 0.3 },
      { to: this.octopusHome.clone(), speed: 0.12, hold: 1e9, doing: 'tucked against a boulder, watching', radius: 0.25 },
    ]);
    return true;
  }
}
