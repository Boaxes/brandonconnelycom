# Puget Sound portfolio

A personal site whose background is a living stretch of Puget Sound seafloor, seen from a diver hanging still near the bottom: photoscanned animals with their own behaviour (hunting, fleeing, curiosity, burying), a scripted first minute of visits, and a notebook page down the middle carrying the portfolio.

Plain **Vite + TypeScript + Three.js**. No React, no framework. Everything renders in one WebGL canvas; the UI is a page of notebook paper in ordinary HTML/CSS, centred, with the scene visible either side.

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
| Scroll | Scrolls the notebook; the camera stays put and the animals come to it |
| Mouse | Slight look-around |
| Click an animal | Name, Latin name and what it is doing right now (the tag follows it for a few seconds) |
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
    Terrain.ts            heightfield seafloor (also queried by the sim), the stage: fixed viewpoint + placement helpers
    Environment.ts        backdrop, silt and plankton cloud, daylight, the diver's torch (aimed at what's being watched)
    CameraRig.ts          fixed diver camera: breathing, handheld drift, mouse parallax
    Assets.ts             GLB loader for the baked scans
  sim/
    Agent.ts              steering, integration, orientation, spatial grid
    behaviors.ts          schools (boids), hunters, benthic fish, bottom walkers, sessile life, scripted routes
    Species.ts            species table (names, swim parameters, look) + per-species InstancedMesh
    World.ts              lays out the stage, predator/prey lookups, respawn, click-to-name
    Director.ts           the scripted first minute, then randomised visits with cooldowns
  ui/                     HTML overlay, HUD, labels, loader
  audio/Ambience.ts       Web Audio ambience and vocalisations (no audio files)
tools/blender/            scan pipeline (and the older procedural creature generator), run inside Blender
public/models/            baked photogrammetry GLBs; see CREDITS.md
public/textures/          CC0 sand / gravel / rock textures from Poly Haven (1K, ~3 MB)
```

### Look

The water is real Puget Sound water: 4–6 m of visibility, green-brown gloom, a cloud of silt and plankton, and a diver's torch that eases toward whatever the diver is watching (and otherwise sweeps between the two sides). Nothing beyond ~18 m is drawn.

Everything alive, plus the boulders, logs and shells, is a photogrammetry scan (CC0 / CC BY / CC BY-NC, see `public/models/CREDITS.md`), each cleaned up and re-baked to a single colour + normal map at 1.5–10k faces. The seafloor blends two photo-scanned CC0 textures (sand, sandy gravel) by warped noise and slope, with normal mapping.

### The stage

The camera never travels. The notebook page covers the middle of the screen, so the scene is composed for the two strips either side of it: set pieces, residents and visitor routes are all placed by camera-relative yaw and distance (`stageFloor`, `randomFloorInMargins` in `Terrain.ts`), recomputed from the window size. Behind the page nothing is rendered: a depth-only card in front of the camera rejects the geometry there, and the post passes skip those pixels. *Watch the water* removes both, so the whole frame fills in.

### The first minute

`Director.ts` scripts what a visitor actually sees: a rockfish drifts over to look at the lens (~3 s), the octopus creeps in and settles by its boulder (~6 s), a harbor seal comes out of the murk, hangs in front of the camera, circles and leaves (~15 s), and orcas pass as shapes at the edge of visibility (~40 s). After that, visits are drawn at random with cooldowns: seals, herring and salmon sweeps, porpoises, orcas, rarely a humpback, the octopus taking a walk. Routes are steered, not railed, so they keep banking and body bend.

### Animation without rigs

Each scan gets swim coordinates derived from its geometry (position along the body, appendage vs. core). The shared vertex shader bends bodies with a travelling wave and sways the octopus's arms; walkers (crabs, prawns) stay rigid and rock a little with each step. Only the sim decides *where* things go.

### Behaviour

- **Herring and salmon** school with boids on a spatial grid around an anchor the director steers through the frame.
- **Rockfish** hold station by their rocks or hang in the water column; now and then one swims over to hang in front of the lens.
- **Dogfish** patrol low over the bottom and hunt prawns and herring.
- **Crabs, prawns, flounder, sculpin, sea cucumbers** forage around a home spot, flee octopus and seals; Dungeness and flounder bury themselves.
- **Seals, orcas, porpoises, the humpback, the octopus** are the director's: scripted routes with lingering and gaze.
- Eaten animals respawn out of sight a while later.

## Regenerating the models

### Scans

`tools/blender/scans.py` turns a downloaded Sketchfab GLB into a game-ready one: strip colour-checker cards, orient, weld and decimate (voxel remesh fallback for fuzzy scans), smart-UV the result and bake the original's colour and normals onto it with Cycles. The source files live in `assets-src/` (git-ignored; `manifest.json` lists each model's URL, author and license). Orientation, target length, face budget and texture size per scan are in the `SCANS` table at the top of the file.

### Procedural models (no longer used by the scene)

The earlier creatures were generated by Python inside Blender (tested on Blender 5.x). With Blender open and the MCP add-on connected — or from Blender's own Python console:

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
- `advance(seconds)` (dev server only) fast-forwards the simulation, e.g. to a moment in the scripted first minute.
- `await shot('name')` (dev server only) renders one frame and saves it to `.shots/name.jpg` through a tiny Vite plugin, with a paper-coloured block where the page is.

## Performance notes

Target is 60 fps on integrated graphics. Every species is one `InstancedMesh`, the sim is small (~300 agents), and the page covers roughly half of the frame that is never shaded. Pixel ratio starts at 1.5 and steps down (never back up) if a machine can't hold ~48 fps. `prefers-reduced-motion` slows the whole scene down; if WebGL 2 is unavailable the portfolio renders on a still gradient.
