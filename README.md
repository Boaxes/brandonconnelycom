# Puget Sound portfolio

A portfolio you read on the floor of Puget Sound. You arrive in the dark about thirty feet down; the light comes up on a red leather book lying on a rock in front of you. Click it and it rises into your hands and opens: the portfolio, with real page turns. Around you the water is alive — photoscanned animals with their own behaviour, a scripted first minute of visits (a curious rockfish, an octopus, a harbor seal, orcas passing overhead), and a field log you fill in by clicking animals.

Plain **Vite + TypeScript + Three.js**. No React, no framework. Everything renders in one WebGL canvas, including both books; the controls are ordinary HTML/CSS, and a visually hidden HTML copy of the portfolio keeps it readable for screen readers and search engines.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static output in dist/
npm run preview    # serve dist/ locally
```

## Editing the portfolio

All text lives in [`src/content.ts`](src/content.ts): name, tagline, about paragraphs, projects, experience, skills, links. The book lays it out across as many pages as it needs ([`src/book/portfolio.ts`](src/book/portfolio.ts)).

- The résumé link points at `/resume.pdf` — drop your PDF into `public/resume.pdf`.
- Species notes in the field log are `TO DO` for now ([`src/book/fieldlog.ts`](src/book/fieldlog.ts)).

## Controls

| Action | Effect |
| --- | --- |
| Click the book | Pick it up and open it; click the right page to turn, the left to go back (← → , PageUp/PageDown, space and the scroll wheel work too); links on the pages open |
| Click an animal | Logs it in the field log the first time (sound, a specimen card flies into the log) |
| Look pad, `A`/`D`/`W`/`S`, arrow keys, drag | Turn the view in steps: 45° left/right all the way round, 30° up/down from straight down to straight up |
| Book button / `B` | Raise or lower the portfolio |
| Log button / `L` | Open the field log: an index of species (click one to read its page) |
| Waves / speaker buttons | Sound (water and animals) and effects (book, pages, logging), separately |
| Eye / `H` | Watch the water: the book drops out of view and the controls fold away |
| `Esc` | Lower the book you're reading |

## How it is put together

```
src/
  main.ts                 boot, the intro, input, the render loop
  content.ts, credits.ts  portfolio copy; attributions (also shown in the book)
  book/
    Page.ts               canvas typesetting: flow layout, page breaks, link hit areas
    Book3D.ts             a 3D book: hinged leather covers, page blocks, a curling leaf, rest/held/lowered poses
    portfolio.ts          the red book's pages
    fieldlog.ts           the field log's pages and what's been logged (kept in localStorage)
  scene/
    Ocean.ts              renderer, post: depth of field, volumetric torch beam, bloom, lens; the fade-in
    UnderwaterMaterial.ts shared shader patch: swim deformation, water absorption, caustics, contact AO
    Terrain.ts            heightfield seafloor and the stage: the fixed viewpoint and heading-based placement
    Environment.ts        backdrop, silt, daylight, the surface overhead, the diver's torch
    CameraRig.ts          stepped look-around with breathing and handheld drift
    Assets.ts             GLB loader for the baked scans (the big visitors load after the reveal)
  sim/
    Agent.ts, behaviors.ts   steering; schools, hunters, rockfish, bottom walkers, fixed life, scripted routes
    Species.ts            species table + one InstancedMesh per species
    World.ts              the ring of scenery, populations, soft collisions, picking
    Director.ts           the scripted first minute, then randomised visits with cooldowns
  audio/Sound.ts          sound and effects buses; recordings from public/sounds if present, synth otherwise
  ui/                     controls, discovery animation, hints, loader
tools/blender/            scan pipeline (and the older procedural generator), run inside Blender
public/models/            baked photogrammetry GLBs; see CREDITS.md
public/textures/          CC0 sand / gravel / rock / leather textures from Poly Haven
```

### The place

About 30 ft down on a rocky Puget Sound bottom, 4–6 m of visibility. The camera never moves; the view turns in steps, so the scenery is a ring with a landmark in each direction: the book on its rock with the octopus's boulder behind (N), a rockfish reef (NE), a wooden wreck (E), a sand flat with sand dollars and moon snails (SE), a pile of big boulders up a rising slope (S, SW), an old anchor where the floor drops away (W), sunken logs (SW, NW). Overhead is the surface: Snell's window, bright and moving with the waves, seen through nine metres of green water.

Everything alive, and every rock, log and prop, is a photogrammetry scan (CC0 / CC BY / CC BY-NC, see `public/models/CREDITS.md`), cleaned up and re-baked to a single colour + normal map. Land scans are tinted down into the water's palette.

### The first minute

`Director.ts` scripts what a visitor actually sees, relative to wherever they're looking: a rockfish comes to look at the lens (~4 s), the octopus creeps in and settles by its boulder (~9 s), a harbor seal comes out of the murk and hangs beside the book looking at you before circling off (~20 s), and at ~38 s orca calls, then the pod passes above. After that visits are drawn at random with cooldowns: seals, herring and salmon, porpoises, orcas (sometimes straight overhead — look up), rarely a humpback singing as it passes over, the octopus taking a walk.

### The books

Pages are canvases typeset at load (fonts are waited for) and shown as textures. The leaf that turns is a strip of 28 segments bent around the spine each frame, with the free edge lagging behind so it curls. Clicks on a page are mapped back to canvas coordinates to find links. The portfolio book is held at 0.5 m and the depth of field focuses on it; lowering it hands focus back to the water.

### Behaviour

- **Herring and salmon** school with boids around an anchor the director steers through the view.
- **Rockfish** hold station on the reef or hang over the wreck; now and then one swims over to hang beside the lens.
- **Dogfish** patrol low and hunt prawns and herring.
- **Crabs, prawns, flounder, sculpin, sea cucumbers** forage around a home spot and flee octopus and seals; Dungeness and flounder bury.
- **Seals, orcas, porpoises, the humpback, the octopus** follow the director's steered routes, with lingering and gaze.
- Bodies push apart when they overlap, and swimmers slide around rocks and props.

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

## Sounds

`src/audio/Sound.ts` plays a recording for each effect and call if one exists: put `<name>.mp3` files in `public/sounds/` and list the names in `public/sounds/manifest.json` (`pickup`, `open`, `close`, `page`, `lower`, `raise`, `discover`, `click`, `ambience-loop`, `orca`, `humpback`, `seal`). Anything missing falls back to a small synthesised version.

## Development helpers

- `window.world`, `window.ocean`, `window.rig`, `window.portfolio`, `window.logBook`, `window.field` are exposed in the console.
- `rig.override = { pos, look }` pins the camera anywhere; `rig.step(yaw, pitch)` turns.
- `advance(seconds)` (dev server only) fast-forwards the simulation, e.g. to a moment in the scripted first minute.
- `await shot('name')` (dev server only) renders one frame and saves it to `.shots/name.jpg` through a tiny Vite plugin.

## Performance notes

Target is 60 fps on integrated graphics; about 11 ms a frame at 1440×900 on an M-series laptop. Every species is one `InstancedMesh`, the sim is ~350 agents (under 1 ms), the sand/gravel mask is baked to a texture, and the orca, humpback and porpoise load after the reveal. Pixel ratio starts at 1.5 and steps down (never back up) if a machine can't hold ~48 fps. `prefers-reduced-motion` slows the scene; without WebGL 2 the portfolio shows as plain text.
