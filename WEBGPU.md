# Moving to WebGPU: notes for the agent doing it

Written after the September 2026 performance pass (commits `e54d8ed`, `b8049ef`, `4424d95`). Read this before
touching the renderer. The short version: **the site is fill-bound, not CPU-bound, so a WebGPU port is a
large rewrite with a modest, uncertain payoff.** The one concrete win it could bring is described under
"Could help", below. Everything here was measured on an Apple M4 (10-core GPU) in Chrome, window
1440×900 at devicePixelRatio 2, renderer pixel ratio 1.5 (the site's cap), unless noted.

## Where the frame time goes now

After the performance pass, with the book held open (the state that matters most):

| Part | GPU ms/frame | Notes |
| --- | --- | --- |
| Scene pass (`RenderPass` into the 4× MSAA half-float target + depth texture) | ~7 | Mostly fixed cost: storing and resolving 4 samples of RGBA16F + depth at 2160×1350. The objects themselves are cheap (terrain 0.6–1.7, animals 0.5–1.5, everything else < 1) |
| Water pass (DOF gather + torch-beam raymarch) | 1.7 (book up) – 3.5 (looking at the water) | |
| Bloom (UnrealBloomPass mips, no full-res blend any more) | ~1 | |
| Output (tonemap + sRGB + bloom add) | 0.4–0.8 | |
| Torch shadow map (1024², PCF) | 0.5–0.9 | |
| Lens (barrel, fringing, vignette, grain) → screen | small | |
| **Total** | **~11–12 held, ~13–14 looking round** | was 26–31 before the pass |

CPU (main thread) is ~1.2 ms per frame in total: simulation ~0.6 (the largest item is `World.separate`, ~0.3),
three's render submission ~0.4, page redraws ~0.1. Draw calls are few (one InstancedMesh per species). Frame
time scales linearly with pixel count (19 / 31 / 50 ms at pixel ratio 1 / 1.5 / 2 before the pass), which is
the signature of a fill/bandwidth-bound frame.

The Chrome trace confirmed it: the GPU process spends ~99% of its time in
`CALayerTreeCoordinator::ApplyBackpressure::Metal` (waiting on the GPU), the page's main thread ~10%.

## What WebGPU would and wouldn't change

**Won't help much:**
- *CPU overhead.* WebGPU's headline advantage is cheaper draw submission. There's ~0.4 ms of it to save.
- *Shader cost.* Chrome's WebGL already runs on Metal (ANGLE); WebGPU runs on Metal (Dawn). The same
  fragment work costs the same on the same GPU.
- *The first-use stalls.* Already removed on WebGL by `Ocean.warmUp()`; WebGPU has the same issue (pipelines
  are built on first use) and would need `renderer.compileAsync()` plus a warm-up draw.

**Could help (the real reason to try it):**
- *MSAA without storing the samples.* WebGL has no way to say "resolve this multisampled buffer and throw the
  samples away", so on Apple's tile-based GPUs the 4× MSAA colour (and depth) are written out to memory and
  read back to resolve. That is most of the ~7 ms scene pass. In WebGPU a render pass can use
  `storeOp: 'discard'` with a `resolveTarget`, so the samples never leave tile memory. On iPhones this is
  exactly the cost that hurts.
  **Catch:** WebGPU can't resolve a multisampled *depth* texture, and the water pass needs scene depth
  (for DOF and to stop the beam). Check how three's `pass()` node (`src/nodes/display/PassNode.js`, which takes
  `{ samples }`) provides depth when multisampled. It may resolve depth with an extra pass, or you may need
  depth from a separate single-sample prepass. If it ends up storing the samples anyway, the win disappears.
- *Compute* could take the simulation off the CPU, but at ~0.6 ms that's not worth doing.

**Risks:**
- *Support.* WebGPU on iOS arrived with Safari 26 (iOS 26, autumn 2025). Older iPhones will get
  `WebGPURenderer`'s **WebGL2 backend**, which in general is slower than `WebGLRenderer`. Measure that path on
  a phone before committing, since it's what a lot of visitors would get.
- *No pixel parity.* The shaders get rewritten in TSL, and bloom and tonemapping come from different code
  paths, so the frame-diff harness below will show real differences. Compare side by side, not for zero.
- *Bundle size and startup.* `three/webgpu` is larger, and `renderer.init()` is async.

**Recommendation:** only port if a phone test shows the MSAA store/resolve dominating there *and* the depth
catch above resolves cleanly. Do it on a branch, keeping the WebGL build shippable. A cheaper experiment first:
drop the half-float MSAA target to `samples: 2` or 0 plus FXAA/SMAA, and see how much of the scene pass it
recovers on the phone. That is a visible trade-off for the owner to decide, not something to change
silently.

## Everything that is WebGL/GLSL-specific (the porting inventory)

`WebGPURenderer` does **not** run `ShaderMaterial`, `RawShaderMaterial` or `onBeforeCompile` patches, on either
backend. Everything below must become node materials (TSL). Files and what each needs:

1. **`src/scene/UnderwaterMaterial.ts`: the big one.** `patchMaterial()` patches every `MeshStandardMaterial`
   through `onBeforeCompile`:
   - Swim deformation in the vertex shader (`SWIM_GLSL`: fish wave, crab gait, jelly bell, appendage sway),
     driven by the `swim` attribute and the per-instance `instPhase` / `instSpeed` / `instBend`
     InstancedBufferAttributes. In TSL use `MeshStandardNodeMaterial.positionNode`, with `attribute()` /
     `instancedBufferAttribute()` for the per-instance data.
   - Seafloor detail (`uDetail == 1`): sand/gravel blend from a CPU-baked mask, two tiling scales, normal
     perturbation. Rocks (`uDetail == 2`): triplanar colour + normal. Use `colorNode` / `normalNode`.
   - Additions after lighting (`lights_fragment_end`): caustics added to direct diffuse, depth-dimmed
     indirect, **contact AO from `uOcc[48]` (vec4 array + count)** on the floor, wet rim, translucency. These
     write into `reflectedLight`, so they need a custom `LightingModel` (or an `outputNode` approximation;
     check against the harness). The occluder array becomes `uniformArray`.
   - Water applied in place of fog (`applyWater`: per-channel absorption + in-scatter along the view ray),
     plus jelly alpha. Use an `outputNode`.
   - `makeDepthMaterial()`: the torch's shadow pass deforms exactly like the colour pass. In TSL the
     material's `positionNode` should carry into the shadow pass; `castShadowPositionNode` exists
     (`src/materials/nodes/NodeMaterial.js`) if it doesn't.
   - `customProgramCacheKey` goes away.
2. **`src/scene/Environment.ts`**
   - `buildBackdrop()`: ShaderMaterial on a back-facing sphere, forced to the far plane (`gl_Position.z = w`).
   - `buildParticles()`: 7000 `THREE.Points` with **`gl_PointSize`** (sized per particle for depth of field,
     up to 34 px × pxScale) and `gl_PointCoord` discs. **WebGPU has no point size.** Use
     `PointsNodeMaterial` with `sizeNode` (three draws those as instanced quads) and `uv()` in place of
     `gl_PointCoord`. It's additive and depth-tested without depth writes.
   - `buildSurface()`: ShaderMaterial (Snell's window, five height evaluations per pixel). It includes
     `tonemapping_fragment` / `colorspace_fragment`, which are no-ops here because it renders into a
     render target; don't port them as real tonemapping.
3. **`src/scene/Bubbles.ts`**: `THREE.Points` with `gl_PointSize` again. Same treatment as the particles.
4. **`src/scene/Ocean.ts`: the post chain** (hand-wired in the performance pass; read the comment on
   `BloomPass` and in the constructor):
   `RenderPass` → MSAA target with `DepthTexture` → `WaterPostShader` (DOF: 14-tap golden spiral gather; beam:
   12-step raymarch with 3D value noise; sun shafts) → `BloomPass.bloomOf()` (UnrealBloomPass steps 1–3) →
   `OutputPass` with its shader patched to add the bloom texture → `LensShader` to the screen.
   In WebGPU: `RenderPipeline` (renamed from `PostProcessing` in r183), `pass(scene, camera, { samples: 4 })`,
   the water pass as a TSL `Fn` (`Loop`, the scene's colour and depth texture nodes), `BloomNode`
   (`three/addons/tsl/display/BloomNode.js`; check its mip chain and threshold match UnrealBloomPass),
   `renderOutput()` for ACES + sRGB, and the lens as TSL. `uPxScale`, the resolution uniforms and
   `resize()` sizing all carry over.
5. **`src/book/Book3D.ts` → `patch()`** sends only a page's moving parts to the GPU with raw WebGL
   (`renderer.properties.get(tex).__webglTexture`, `texSubImage2D`, `generateMipmap`). On WebGPU that would be
   `device.queue.copyExternalImageToTexture` with an `origin` into the existing `GPUTexture`, then
   regenerating its mips (three's `WebGPUTextureUtils` has both pieces; there's no public API). `patch()`
   already returns false when it can't do it, falling back to a full upload (`needsUpdate`), so it keeps
   *working* unchanged. It just costs ~2–5 ms a frame more while an animated spread is open.
   Pages are plain `CanvasTexture`s otherwise (sRGB, flipY, mipmaps, anisotropy 8), which work as they are.
6. **`src/scene/Ocean.ts` → `warmUp()`**: draws everything once under the loader so shaders, pipelines and
   textures exist before the visit. Keep the idea. Use `await renderer.compileAsync(scene, camera)` and keep
   the forced draw for texture uploads.
7. **Shadows**: one SpotLight, `PCFShadowMap`, `radius 5`, 1024² map, `normalBias 0.06`. Check that WebGPU's
   PCF honours `radius`; soft torch shadows are part of the look.
8. **`src/main.ts`**: the WebGL2 check before building `Ocean` (falls back to the plain-text portfolio);
   `ocean.renderer.domElement.toDataURL` in the dev `shot()` helper; the warm-up call.
9. **`three/addons` imports**: `RenderPass`, `ShaderPass`, `OutputPass`, `UnrealBloomPass`, `Pass`
   (FullScreenQuad). All WebGL-only.

Colour pipeline to reproduce: linear HDR, half-float targets; `ACESFilmicToneMapping` with exposure
`1.4 × fade²`, applied once in the output pass; sRGB output; the lens and grain in display space after it.

## Tools for checking your work: `tools/perf/`

`cd tools/perf && npm install`, then run against the dev server (`npm run dev` at the root). All of them drive
the installed Google Chrome, headed, so they use the real GPU.

- `prof.mjs`: steps through the opening, the book held on several spreads, continuous page turning and the
  open water, printing frame time, the JS time of `ocean.render` / `world.update` / `portfolio.update`, and
  texture upload traffic for each. `UNCAP=1` turns vsync off, so the numbers measure the GPU rather than the
  display. `FIXPR=1.5` pins the pixel ratio (otherwise the adaptive quality in `Ocean.adapt()` may lower it
  mid-run). `TRACE=<state>` writes a Chrome trace for that state.
- `hitch.mjs`: a scripted session (opening, pickup, every page, look all the way round, wait for the orcas),
  logging every frame. It prints frames over 25 ms with the shader links and texture uploads that happened in
  them.
- `cap.mjs <url> <dir>`, then `diff.mjs <dirA> <dirB>` (and `dimg.mjs` for an amplified diff image):
  deterministic frame captures of ten states, for before/after comparisons. It seeds `Math.random`, holds the
  site's rAF loop, steps the simulation with the dev `advance()` helper and reads frames back as PNG. To
  compare against the old renderer, serve the old commit from a `git worktree` on a second port.

Things learned the hard way while building these:
- **three's `generateUUID` draws from `Math.random`.** Creating a different number of objects (render
  targets, materials) shifts the seeded sequence, and the simulation diverges. `cap.mjs` gives UUIDs their own
  random stream for that reason.
- The page videos are never attached to the DOM, so `querySelectorAll('video')` finds none. To pause them,
  wrap `HTMLMediaElement.prototype.play` before load (`page.evaluateOnNewDocument`) to collect them. Frames showing a video page
  are never deterministic.
- Calling `getImageData` on a page canvas makes Chrome move it off the GPU, which changes how it rasterises.
  Snapshot through a separate canvas instead.
- **GPU timer queries** (`EXT_disjoint_timer_query_webgl2`) give nonsense per pass on ANGLE/Metal. Measure by
  ablation instead: stub a pass and time the uncapped frame, repeat A/B a few times, since runs drift ±2–3 ms.
- Toggling visibility of **lights** (or the camera, which carries the torch) changes the light count and
  recompiles every material: 400 ms frames that aren't the site's fault.
- The desktop app's browser pane stops rAF while it's hidden, so it's no good for timing.

## Also relevant to the mobile pass

Memory, not speed, is the likely problem on an iPhone. Every page of the book is a 1024×1434 canvas built at
startup (14 × 5.9 MB), each animated page keeps a second copy of itself (`Page.base`, 8 × 5.9 MB), and every
page visited gets a mipmapped texture (~7.8 MB each, never released). That's roughly 130 MB of canvases, plus
up to ~110 MB of textures, before the 21 MB of scans and their 2K maps. iOS Safari limits total canvas memory
and kills tabs that use too much. Building pages lazily and releasing textures of distant spreads would bound
it, with no visible difference.
