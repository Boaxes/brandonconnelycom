# Puget Sound portfolio

A personal site whose background is a living stretch of Puget Sound seafloor: procedurally modelled low-poly animals with their own behaviour (hunting, fleeing, breathing, resting, burying), a drifting camera tied to the page scroll, and a light portfolio layer on top.

Plain **Vite + TypeScript + Three.js**. No React, no framework. Everything renders in one WebGL canvas; the UI is a strip of notebook paper in ordinary HTML/CSS.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static output in dist/
npm run preview    # serve dist/ locally
```

## Editing the portfolio

All text lives in [`src/content.ts`](src/content.ts): name, tagline, about paragraphs, projects, experience, skills, links. Nothing in the 3D scene depends on it.

- The **Resume** button points at `/resume.pdf` — drop your PDF into `public/resume.pdf`.
- Section layout and styling: [`src/ui/overlay.ts`](src/ui/overlay.ts), [`src/ui/style.css`](src/ui/style.css).

## Controls

| Action | Effect |
| --- | --- |
| Scroll | Drifts the camera along a loop above the seafloor while the page scrolls |
| Mouse | Gentle look-around |
| Hover an animal | Name, Latin name and what it is doing right now |
| `W` / *Watch the water* | Hides the notebook so only the scene is visible (`Esc` to come back) |
| Field log | The species list at the foot of the notebook ticks itself as animals pass the camera |
| *Sound* | Synthesised underwater ambience with calls from nearby orcas, whales and seals. Off by default |

## How it is put together

```
src/
  main.ts                 boot, render loop, loader, fallback
  content.ts              portfolio copy
  scene/
    Ocean.ts              renderer, post: depth of field, volumetric torch beam, bloom, lens (distortion, grain)
    UnderwaterMaterial.ts one shared shader patch: swim deformation, water absorption, caustics, contact AO, translucency
    Terrain.ts            heightfield seafloor (also queried by the sim), debris
    Environment.ts        backdrop, silt and plankton cloud, daylight, the diver's torch
    CameraRig.ts          diver camera: scroll-driven loop, breathing, handheld drift, attention, mouse look
    Assets.ts             GLB loader (procedural models and baked scans)
  sim/
    Agent.ts              steering, integration, orientation, spatial grid
    behaviors.ts          schools (boids), hunters, pods, benthic fish, crabs, octopus, jellies, sessile life
    Species.ts            species table (names, swim parameters, look) + per-species InstancedMesh
    World.ts              populates the field, predator/prey lookups, respawn, visitor schedule, hover picking
  ui/                     HTML overlay, HUD, labels, loader
  audio/Ambience.ts       Web Audio ambience and vocalisations (no audio files)
tools/blender/            procedural creature generator and scan pipeline (run inside Blender)
public/models/            exported GLBs (scan_*.glb are baked photogrammetry; see CREDITS.md)
public/textures/          CC0 sand / gravel / rock textures from Poly Haven (1K, ~3 MB)
```

### Look

The water is real Puget Sound water: 4–6 m of visibility, green-brown gloom, a cloud of silt and plankton that follows the camera, and a diver's torch mounted on the camera that picks out whatever is close. Nothing beyond ~16 m is drawn at all, which is most of the performance budget.

Most animals, the boulders, barnacle slabs and sunken logs are photogrammetry scans (CC0 / CC BY, see `public/models/CREDITS.md`), each cleaned up and re-baked to a single 1–2K colour + normal map at 2–10k faces. Kelp, jellies, anemones, sea pens and a few animals with no usable scan are procedural models with per-vertex colour. The seafloor blends two photo-scanned CC0 textures (sand, sandy gravel) by noise and slope with normal mapping.

The scenery is spaced evenly along a ~160 m camera loop with a clear lane for the diver: boulders, logs and slabs flank it, plumose anemones are raycast onto the rock and log surfaces, and sea pens and tube anemones fill the open sand between. Only the set pieces inside the murk are drawn each frame.

### Animation without rigs

Every model is exported with UVs that encode *where on the body* a vertex is (`u` = nose→tail or base→tip, `v` = body / fin / appendage). The shared vertex shader bends bodies with a travelling wave and sways tentacles, legs and kelp blades, so fish, whales, jellies and kelp all animate from the same material with per-instance phase and speed. Only the sim decides *where* things go.

### Behaviour

- **Herring and salmon** school with boids on a spatial grid, follow a slowly wandering anchor, and scatter from predators.
- **Seals, sea lions, dolphins, porpoises and orcas** cruise, hunt (with lead pursuit), eat, and must surface to breathe on an oxygen budget. Seals rest on the bottom.
- **Orca pods, dolphins, porpoises and the humpback** are visitors: they transit the field in formation on a schedule and leave.
- **Lingcod and rockfish** hold station by their rock; lingcod lunge at herring that pass.
- **Crabs** forage, scuttle sideways, flee from octopus and seals, and Dungeness bury themselves.
- **Giant Pacific octopus** rests at a den by a boulder, prowls, stalks and pounces on crabs, then returns.
- **Jellies** drift on a slow current field and pulse.
- Eaten animals respawn out of sight a while later, so populations are stable indefinitely.

## Regenerating the models

### Scans

`tools/blender/scans.py` turns a downloaded Sketchfab GLB into a game-ready one: strip colour-checker cards, orient, weld and decimate (voxel remesh fallback for fuzzy scans), smart-UV the result and bake the original's colour and normals onto it with Cycles. The source files live in `assets-src/` (git-ignored; `manifest.json` lists each model's URL, author and license). Orientation, target length, face budget and texture size per scan are in the `SCANS` table at the top of the file.

### Procedural models

The creatures are generated by Python inside Blender (tested on Blender 5.x). With Blender open and the MCP add-on connected — or from Blender's own Python console:

```python
exec(open('/path/to/tools/blender/run.py').read())
export_all()            # builds, renders a contact sheet per species, exports public/models/*.glb
preview('orca')         # one species
```

Shape and colour parameters are in `tools/blender/creatures.py`; the lofting toolkit is `tools/blender/lib.py`.

## Deploying

The site is fully static. `npm run build` puts everything in `dist/`.

- **GitHub Pages**: a workflow is included at `.github/workflows/deploy.yml`. Enable Pages (Settings → Pages → Source: GitHub Actions). If the site is served from `https://<user>.github.io/<repo>/`, add a repository variable `BASE_PATH` = `/<repo>/`.
- **Cloudflare Pages / Netlify / Vercel**: build command `npm run build`, output directory `dist`.

## Development helpers

- `window.world`, `window.ocean`, `window.rig` are exposed in the console.
- `rig.override = { pos, look }` pins the camera anywhere.
- `await shot('name')` (dev server only) renders one frame and saves it to `.shots/name.jpg` through a tiny Vite plugin, handy for reviewing the scene at full resolution.

## Performance notes

Target is 60 fps on integrated graphics. Draw calls stay around 35 because every species is one `InstancedMesh`; the sim costs ~1.5 ms/frame for ~1,200 agents. Pixel ratio adapts automatically if a machine cannot keep up. `prefers-reduced-motion` slows the whole scene down; if WebGL 2 is unavailable the portfolio renders on a still gradient.
