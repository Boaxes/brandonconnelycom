import * as THREE from 'three';
import { floorHeight } from '../scene/Terrain';

/**
 * A height map of everything solid standing on the floor (rocks, the wreck, driftwood): for each 20 cm
 * cell, the highest point of any placed piece above it. Built once from the real scanned geometry, so
 * swimmers steer over and around what is actually there rather than round invisible circles.
 */
const CELL = 0.2;
const N = 220; // 44 m across, centred on the viewpoint
const NONE = -1e9;
const tops = new Float32Array(N * N).fill(NONE);
let ox = 0;
let oz = 0;

export function resetObstacles(centre: THREE.Vector3) {
  tops.fill(NONE);
  ox = centre.x - (N * CELL) / 2;
  oz = centre.z - (N * CELL) / 2;
}

const _p = new THREE.Vector3();

/** Splat a placed mesh's vertices (world space via `matrix`) into the map. */
export function addObstacle(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4) {
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    const cx = Math.floor((_p.x - ox) / CELL);
    const cz = Math.floor((_p.z - oz) / CELL);
    if (cx < 0 || cz < 0 || cx >= N || cz >= N) continue;
    const k = cz * N + cx;
    if (_p.y > tops[k]) tops[k] = _p.y;
  }
}

/** Close the gaps between splatted vertices (one-cell max filter), and drop anything under the floor. */
export function finishObstacles() {
  const src = tops.slice();
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      let m = src[z * N + x];
      for (let dz = -1; dz <= 1; dz++) {
        const zz = z + dz;
        if (zz < 0 || zz >= N) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= N) continue;
          const v = src[zz * N + xx];
          if (v > m) m = v;
        }
      }
      const wx = ox + (x + 0.5) * CELL;
      const wz = oz + (z + 0.5) * CELL;
      tops[z * N + x] = m > floorHeight(wx, wz) + 0.05 ? m : NONE;
    }
  }
}

/** Highest solid point above (x, z), or -1e9 where there's nothing but the floor. */
export function obstacleTop(x: number, z: number): number {
  const cx = Math.floor((x - ox) / CELL);
  const cz = Math.floor((z - oz) / CELL);
  if (cx < 0 || cz < 0 || cx >= N || cz >= N) return NONE;
  return tops[cz * N + cx];
}

/** The bottom as a swimmer sees it: the floor, or the top of whatever stands on it. */
export function bottomAt(x: number, z: number): number {
  return Math.max(floorHeight(x, z), obstacleTop(x, z));
}

const DIRS = Array.from({ length: 12 }, (_, i) => [Math.cos((i / 12) * Math.PI * 2), Math.sin((i / 12) * Math.PI * 2)]);

/**
 * For a body at `pos` inside an obstacle: the horizontal direction to the nearest way out at its own
 * height (written to `out`), or false if it's clear.
 */
export function escapeDir(pos: THREE.Vector3, clearance: number, out: THREE.Vector3): boolean {
  if (obstacleTop(pos.x, pos.z) + clearance <= pos.y) return false;
  for (let r = CELL * 1.5; r < 3; r += CELL * 1.5) {
    let best = -1;
    let bestTop = Infinity;
    for (let i = 0; i < DIRS.length; i++) {
      const t = obstacleTop(pos.x + DIRS[i][0] * r, pos.z + DIRS[i][1] * r);
      if (t < bestTop) {
        bestTop = t;
        best = i;
      }
    }
    if (bestTop + clearance <= pos.y) {
      out.set(DIRS[best][0], 0, DIRS[best][1]);
      return true;
    }
  }
  out.set(0, 1, 0);
  return true;
}
