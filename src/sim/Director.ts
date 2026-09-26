import * as THREE from 'three';
import type { Agent } from './Agent';
import { BenthicFish, type Leg, type Scripted } from './behaviors';
import { floorHeight, headingDir, stage, WORLD, yawOf } from '../scene/Terrain';
import type { World } from './World';
import { sound } from '../audio/Sound';

/**
 * Stages the visits. The first minute is scripted, because that's what a visitor actually sees:
 *   ~4 s   a rockfish drifts over to look at the camera
 *   ~10 s  a school of herring sweeps across
 *   opening: a California sea lion is already behind the book's rock when the torch comes on, staring
 *          into the lens until the book is picked up, then darts off (see `opener`)
 *   ~70 s  a sea lion comes out of the murk, hangs beside the book for a good look, circles, leaves
 *   ~38 s  orca calls, then the pod passes high overhead, dark shapes just under the surface
 * The octopus is an easter egg: it hides in a crevice between two boulders to the south from the start,
 * and now and then edges out a little and back.
 * After that, visits are drawn at random (with cooldowns). Routes are laid out relative to wherever the
 * visitor is looking at the time, so the moment isn't missed; the orcas and the whale stay high.
 */
export class Director {
  t = 0;
  /** the animal the diver is paying attention to: the torch and focus follow it */
  hero: Agent | null = null;
  private queue: { at: number; run: () => void }[] = [];
  private last: Record<string, number> = {};
  private nextRandom = 64;
  /** something is passing overhead: the controls can suggest looking up */
  onLookUp: (() => void) | null = null;

  constructor(private w: World, private view: () => { yaw: number; pitch: number }) {
    this.at(4, () => this.rockfishHello());
    this.at(0, () => this.octopusHide());
    this.at(10, () => this.schoolPass('herring', 1.8, 2.5));
    this.at(70, () => this.sealionVisit());
    this.at(38, () => this.orcaPass(false));
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
    const menu: [string, number, number, () => boolean][] = [
      // name, weight, cooldown (s), run
      ['sealion', 3, 70, () => this.sealionVisit()],
      ['herring', 2, 45, () => this.schoolPass('herring', 1.8, 2.5)],
      ['rockfish', 2, 30, () => this.rockfishHello()],
      ['porpoise', 1.4, 100, () => this.porpoisePass()],
      ['salmon', 1, 90, () => this.schoolPass('chinook', 1.6, 2)],
      ['octopus', 1.2, 80, () => this.octopusPeek()],
      ['orca', 1, 200, () => this.orcaPass(Math.random() < 0.5)],
      ['humpback', 0.6, 360, () => this.t > 150 && this.humpbackPass()],
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

  // ---------------------------------------------------------------- helpers

  /**
   * A point `dist` metres out along heading `yaw`, `dy` metres above (or below) the camera, kept off
   * the floor and under the surface.
   */
  private pt(yaw: number, dist: number, dy: number, out = new THREE.Vector3()) {
    const s = stage();
    headingDir(yaw, out).multiplyScalar(dist).add(s.cam);
    out.y = s.cam.y + dy;
    out.y = THREE.MathUtils.clamp(out.y, floorHeight(out.x, out.z) + 0.6, WORLD.surfaceY - 1.2);
    return out;
  }

  // ---------------------------------------------------------------- repertoire

  private rockfishHello(): boolean {
    const cam = stage().cam;
    const fish: BenthicFish[] = [];
    for (const key of ['rockfish', 'blackrockfish']) {
      for (const a of this.w.pops.get(key)?.agents ?? []) if (a instanceof BenthicFish && a.alive && a.state === 'cruise') fish.push(a);
    }
    // prefer one near where the visitor is looking
    const yaw = this.view().yaw;
    const off = (a: BenthicFish) => Math.abs(Math.atan2(Math.sin(yawOf(a.pos) - yaw), Math.cos(yawOf(a.pos) - yaw)));
    fish.sort((a, b) => off(a) + a.pos.distanceTo(cam) * 0.1 - (off(b) + b.pos.distanceTo(cam) * 0.1));
    const f = fish.find((a) => a.comeLook(yaw));
    if (!f) return false;
    if (!this.hero) this.hero = f;
    return true;
  }

  /** A sea lion comes in from the murk, hangs beside the book for a good look, circles, loses interest. */
  private sealionVisit(): boolean {
    const s = this.w.scripted('sealion');
    if (!s) return false;
    // a rockfish hanging where the sea lion is about to stop would crowd the shot: it backs off
    BenthicFish.inspecting?.leave();
    const cam = stage().cam;
    const y = this.view().yaw;
    const side = Math.random() < 0.5 ? -1 : 1;
    const legs: Leg[] = [
      { to: this.pt(y + side * 0.5, 6, 0.4), speed: 1.8, doing: 'gliding in from the murk' },
      { to: this.pt(y + side * 0.46, 2.8, -0.25), speed: 1.1, hold: 5, face: cam, doing: 'having a good look at you' },
      { to: this.pt(y + side * 0.8, 3.4, 0.3), speed: 1.0, doing: 'circling for a better look' },
      { to: this.pt(y + side * 0.42, 3.8, 0), speed: 1.0, hold: 2.2, face: cam, doing: 'watching you, whiskers forward' },
      { to: this.pt(y - side * 0.35, 6.5, 1.6), speed: 2.3, doing: 'losing interest' },
      { to: this.pt(y - side * 1.5, 15, 3), speed: 3, doing: 'heading off to hunt' },
    ];
    s.start(this.pt(y + side * 0.55, 15, 1.2), legs);
    this.hero = s;
    sound.call('sealion', 8);
    return true;
  }

  private openerBody: Scripted | null = null;

  /**
   * The opening hook: a sea lion is already there when the torch comes on, behind the book's rock with its
   * head and shoulders over it, staring into the lens (`eye`) until the book is picked up.
   */
  opener(eye: THREE.Vector3) {
    const s = this.w.scripted('sealion');
    if (!s) return;
    const book = this.w.bookRest.pos;
    const toCam = new THREE.Vector3().subVectors(stage().cam, book).setY(0).normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(toCam).normalize();
    const mark = book.clone().addScaledVector(right, 0.1).addScaledVector(toCam, -1.3).add(new THREE.Vector3(0, -0.14, 0));
    s.start(mark, [{ to: mark, speed: 1.0, hold: 1e9, face: eye, doing: 'staring at you over the rock', radius: 0.25, settle: true }]);
    this.openerBody = s;
  }

  /** The book's been picked up: the sea lion startles and darts off. */
  openerBolt() {
    const s = this.openerBody;
    this.openerBody = null;
    if (!s || !s.alive) return;
    const book = this.w.bookRest.pos;
    const toCam = new THREE.Vector3().subVectors(stage().cam, book).setY(0).normalize();
    const away = toCam.clone().negate();
    const side = new THREE.Vector3(0, 1, 0).cross(toCam).normalize().multiplyScalar(Math.random() < 0.5 ? 1 : -1);
    s.setLegs([
      { to: book.clone().addScaledVector(away, 2.5).addScaledVector(side, 2.5).add(new THREE.Vector3(0, 1.2, 0)), speed: 4.5, doing: 'bolting' },
      { to: book.clone().addScaledVector(away, 16).addScaledVector(side, 8).add(new THREE.Vector3(0, 3, 0)), speed: 4, doing: 'gone' },
    ]);
    s.vel.addScaledVector(away, 2).add(new THREE.Vector3(0, 1.5, 0));
    sound.sealionDart();
  }

  /**
   * An orca pod passes above. Their calls come first; then three or four dark shapes cross, either in
   * front and above (visible at the top of a level view) or straight overhead (look up).
   */
  private orcaPass(overhead: boolean): boolean {
    const n = 3 + Math.round(Math.random());
    const y = this.view().yaw;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const bodies: Scripted[] = [];
    for (let i = 0; i < n; i++) {
      const o = this.w.scripted('orca');
      if (!o) break;
      // claim now, start staggered
      o.start(this.pt(y, 30, 5), []);
      o.done = false;
      o.alive = false;
      bodies.push(o);
    }
    if (!bodies.length) return false;
    sound.call('orca', 20);
    this.onLookUp?.();
    // at the surface, dorsal fins just breaking it, nearly overhead: dark shapes crossing the bright
    // window of the surface when you look up (the murk swallows anything much further off)
    const dist = overhead ? 2 : 5;
    const top = WORLD.surfaceY - stage().cam.y - 1.2;
    bodies.forEach((o, i) => {
      const dy = top;
      const lane = dist + i * 0.9;
      this.at(this.t + 2.5 + i * 2.1, () => {
        o.start(this.pt(y - dir * 1.5, 20, dy), [
          { to: this.pt(y - dir * 0.55, lane, dy), speed: 2.6, doing: 'travelling with the pod' },
          { to: this.pt(y + dir * 0.55, lane, dy), speed: 2.6, doing: 'travelling with the pod' },
          { to: this.pt(y + dir * 1.5, 20, dy), speed: 3, doing: 'travelling with the pod' },
        ]);
        o.surfaceRide = 1.05;
        if (i === 0) this.hero = o;
        if (i === 1) sound.call('orca', 10);
      });
    });
    return true;
  }

  private porpoisePass(): boolean {
    const y = this.view().yaw;
    const dir = Math.random() < 0.5 ? 1 : -1;
    let started = 0;
    for (let i = 0; i < 2; i++) {
      const p = this.w.scripted('porpoise');
      if (!p) break;
      const lane = 5.5 + i * 0.9;
      const dy = 1.2 + i * 0.4;
      p.start(this.pt(y - dir * 1.4, 14, dy), [
        { to: this.pt(y - dir * 0.5, lane, dy), speed: 3.3, doing: 'passing through fast' },
        { to: this.pt(y + dir * 0.5, lane, dy + 0.3), speed: 3.3, doing: 'passing through fast' },
        { to: this.pt(y + dir * 1.5, 16, dy + 1), speed: 3.6, doing: 'gone as quickly as it came' },
      ]);
      if (i === 0) this.hero = p;
      started++;
    }
    return started > 0;
  }

  /** The humpback passes high overhead, singing. */
  private humpbackPass(): boolean {
    const hb = this.w.scripted('humpback');
    if (!hb) return false;
    const y = this.view().yaw;
    const dir = Math.random() < 0.5 ? 1 : -1;
    sound.call('humpback', 15);
    this.onLookUp?.();
    const hy = WORLD.surfaceY - stage().cam.y - 3.3;
    hb.start(this.pt(y - dir * 1.4, 26, hy), [
      { to: this.pt(y - dir * 0.6, 5, hy), speed: 1.6, doing: 'passing overhead, huge and unhurried' },
      { to: this.pt(y + dir * 0.6, 5, hy), speed: 1.6, doing: 'passing overhead, huge and unhurried' },
      { to: this.pt(y + dir * 1.4, 26, hy), speed: 1.8, doing: 'fading into the murk' },
    ]);
    this.hero = hb;
    this.at(this.t + 7, () => sound.call('humpback', 8));
    return true;
  }

  /** A school sweeps across in front of the camera and on out. */
  private schoolPass(key: string, speed: number, dy: number): boolean {
    const sc = this.w.school(key);
    if (!sc) return false;
    const y = this.view().yaw;
    const dir = Math.random() < 0.5 ? 1 : -1;
    sc.route = [
      this.pt(y - dir * 1.3, 13, dy + 0.5),
      this.pt(y - dir * 0.5, 5.5, dy),
      this.pt(y + dir * 0.5, 6, dy + 0.4),
      this.pt(y + dir * 1.4, 14, dy + 1),
    ];
    sc.routeSpeed = speed;
    return true;
  }

  /** The octopus is already in its crevice when the dive starts. */
  private octopusHide(): boolean {
    const o = this.w.scripted('octopus');
    if (!o) return false;
    const den = this.w.den;
    o.start(den.clone(), [
      { to: den.clone(), speed: 0.1, hold: 1e9, face: stage().cam, doing: 'wedged in its crevice, one eye out', radius: 0.2 },
    ]);
    o.heading = Math.atan2(this.w.denFacing.z, this.w.denFacing.x);
    return true;
  }

  /** Now and then it edges out of the gap a little, has a feel around, and pulls back in. */
  private octopusPeek(): boolean {
    const o = this.w.pops.get('octopus')?.agents[0] as Scripted | undefined;
    if (!o || !o.alive) return this.octopusHide();
    const den = this.w.den;
    const out = den.clone().addScaledVector(this.w.denFacing, 0.3 + Math.random() * 0.2);
    out.y = floorHeight(out.x, out.z);
    o.setLegs([
      { to: out, speed: 0.08, doing: 'edging out of its crevice', radius: 0.1 },
      { to: out.clone(), speed: 0.08, hold: 5 + Math.random() * 6, face: stage().cam, doing: 'feeling around the rocks with one arm', radius: 0.2 },
      { to: den.clone(), speed: 0.1, hold: 1e9, face: stage().cam, doing: 'wedged in its crevice, one eye out', radius: 0.2 },
    ]);
    return true;
  }
}
