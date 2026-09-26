# Puget Sound portfolio

A portfolio you read on the floor of Puget Sound. You arrive in the dark about thirty feet down; the light comes up close on a red leather book lying on a rock. Click it and it rises to your eye and opens: the portfolio, with real page turns, a contents page and index tabs. Put it down and the camera pulls back to show where you are. Around you the water is alive — photoscanned animals with their own behaviour, a scripted first minute of visits (a curious rockfish, herring, a California sea lion, orcas passing along the surface), an octopus hiding somewhere for the observant, and a field log you fill in by clicking animals.

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
- Species notes in the field log are `TO DO` for now ([`src/ui/fieldlog.ts`](src/ui/fieldlog.ts)).

## Controls

| Action | Effect |
| --- | --- |
| Click the book | Pick it up and open it; click the right page to turn, the left to go back (← → , PageUp/PageDown and space work too). Near a page's outer edge its corner lifts. The contents page and the index tabs on the fore-edge jump straight to a section; links on the pages open |
| Scroll | Reading: magnify the page under the pointer, PDF-style (drag to move around a zoomed page). Otherwise: zoom the view toward the pointer, up to 4×. A lens click with each notch. The magnifier button / `Z` switches zoom off, and then the wheel turns pages |
| Click an animal | Logs it in the field log the first time (sound, a specimen card flies into the log) |
| Look pad, `A`/`D`/`W`/`S`, arrow keys, drag | Turn the view in steps: 45° left/right all the way round, 30° up/down from straight down to straight up |
| Portfolio button (bottom middle) / `B` | Raise or lower the portfolio; appears once the book has been picked up |
| Log button / `L` | Open the field log, a sheet of ruled notebook paper: an index of species (click one to read its page) |
| Waves / speaker buttons | Background (the water) and effects (book, pages, zoom, logging, animal calls), separately; both start on |
| Eye / `H` | Watch the water: the book drops out of view and the controls fold away |
| `Esc` | Close the field log, zoom back out, or lower the book you're reading |

Everything except the portfolio button sits in a small paper card in the bottom-right corner: the field log, the look pad around the zoom toggle, sound and effects, and the eye.

## How it is put together

```
src/
  main.ts                 boot, the intro, input, the render loop
  content.ts, credits.ts  portfolio copy; attributions (also shown in the book)
  book/
    Page.ts               canvas typesetting: flow layout, page breaks, link hit areas
    Book3D.ts             a 3D book: hinged leather covers, page blocks, a curling leaf, rest/held/lowered poses
    portfolio.ts          the red book's pages
  scene/
    Ocean.ts              renderer, post: depth of field, volumetric torch beam, bloom, lens; the fade-in
    UnderwaterMaterial.ts shared shader patch: swim deformation, water absorption, caustics, contact AO
    Terrain.ts            heightfield seafloor and the stage: the fixed viewpoint and heading-based placement
    Environment.ts        backdrop, silt, daylight, the surface overhead, the diver's torch
    CameraRig.ts          stepped look-around, zoom toward the pointer, breathing and handheld drift
    Assets.ts             GLB loader for the baked scans (the big visitors load after the reveal)
  sim/
    Agent.ts, behaviors.ts   steering; schools, hunters, rockfish, bottom walkers, fixed life, scripted routes
    Species.ts            species table + one InstancedMesh per species
    World.ts              the ring of scenery (settled onto the terrain), populations, soft collisions, picking
    Obstacles.ts          height map of the rocks and props, so swimmers go over and around what is really there
    Director.ts           the scripted first minute, then randomised visits with cooldowns
  audio/Sound.ts          sound and effects buses; recordings from public/sounds if present, synth otherwise
  ui/                     the corner card and book button, the field log page, discovery animation, loader
tools/blender/            scan pipeline (and the older procedural generator), run inside Blender
public/models/            baked photogrammetry GLBs; see CREDITS.md
public/textures/          CC0 sand / gravel / rock / leather textures from Poly Haven
```

### The place

About 30 ft down on a rocky Puget Sound bottom, 4–6 m of visibility. The camera never moves; the view turns in steps, so the scenery is a ring with a landmark in each direction: the book on a boulder with more rocks behind (N), a rockfish reef (NE), a wooden wreck (E), a sand flat with sand dollars and moon snails (SE), a pile of big boulders up a rising slope (S, SW), an old anchor where the floor drops away (W), waterlogged driftwood (SW, NW). Overhead is the surface, a rough sea seen from below: swell and chop refract the light, so Snell's window breaks into moving bright and dark facets, with faint shafts of sunlight slanting down through nine metres of green water. Every piece of scenery is settled onto the terrain under it, so nothing floats on a slope.

Everything alive, and every rock, log and prop, is a photogrammetry scan (CC0 / CC BY / CC BY-NC, see `public/models/CREDITS.md`), cleaned up and re-baked to a single colour + normal map. Land scans are tinted down into the water's palette.

### The opening

The camera starts close over the book on its rock, torch turned down, the rest of the dive blurred behind it — nothing to read but the book. The first time the book is put down (or the view is turned), the camera makes one slow pull-back to the diver's spot and stays there.

### The first minute

`Director.ts` scripts what a visitor actually sees, relative to wherever they're looking: a rockfish comes to look at the lens (~4 s), a school of herring sweeps across (~10 s), a California sea lion comes out of the murk and hangs beside the book looking at you before circling off (~20 s), and at ~38 s orca calls, then the pod travels along the surface overhead, dorsal fins just breaking it, rising and dipping — dark shapes against the light, with the look-up arrow on the controls nudging you. After that visits are drawn at random with cooldowns: sea lions, herring and salmon, porpoises, orcas, rarely a humpback singing as it passes over.

The octopus is an easter egg: camouflaged and wedged into a crevice between two boulders at the foot of the rock pile to the south, it is there from the start and now and then edges out a little and back in.

### The books

Pages are canvases typeset at load (fonts are waited for) and shown as textures; the flow layout records where each section lands so the contents page and the tabs can jump there. Picked up, the book leaves the world for an overlay pass drawn after all the water effects, through its own 22° camera: square to the eye, perfectly still and sharp, close to a flat document but still a real book (the handoff keeps it at the same place and size on screen). The water behind dims a little. Zoom and pan move that camera, like a PDF viewer.

The turning leaf is a grid bent around the spine each frame, row by row: the free edge lags, the bottom corner leads, so it turns with a diagonal curl. It's shaded by how it faces the light, with a faint sheen along the bend, and casts a moving shadow on the page underneath. Hovering near an outer edge lifts that corner; a jump of several pages riffles through a few quick leaves.

### Behaviour

- **Herring and salmon** school with boids around an anchor the director steers through the view.
- **Rockfish** hold station on the reef or hang over the wreck; now and then one swims over to hang beside the lens.
- **Dogfish** patrol low and hunt prawns and herring. Like real sharks they never stop swimming, and never hang nose-up.
- **Crabs, prawns, flounder, sculpin, sea cucumbers** forage around a home spot and flee octopus and sea lions; Dungeness and flounder bury.
- **Sea lions, orcas, porpoises, the humpback, the octopus** follow the director's steered routes, with lingering and gaze; the orcas ride the surface.
- Bodies push apart when they overlap. Rocks and props are baked into a height map from their real geometry: swimmers rise over them like a slope, and anything that ends up inside slides out sideways rather than jumping.

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

Every sound is a recording in `public/sounds/`, listed in `manifest.json` and credited in `public/sounds/CREDITS.md`: CC0 clips from Freesound (water ambience, book handling, page turns, cloth, a pencil scribble for logging, a lens focus ring for the zoom, humpback song, sea lion barks, and a whale's surfacing breath, low-passed, for the orcas). They were trimmed and normalised in Blender (`aud`); the water is a seamless loop. `src/audio/Sound.ts` plays them on two buses — background (the water) and effects (everything else, including animal calls, lightly muffled as if through water) — and falls back to a small synthesised version of anything that fails to load. Audio starts on the first click or key press anywhere; browsers don't allow it sooner.

Nothing is remembered between visits: sound, zoom and the field log all start fresh on every load.

## Development helpers

- `window.world`, `window.ocean`, `window.rig`, `window.portfolio`, `window.logBook`, `window.field` are exposed in the console.
- `rig.override = { pos, look }` pins the camera anywhere; `rig.step(yaw, pitch)` turns.
- `advance(seconds)` (dev server only) fast-forwards the simulation, e.g. to a moment in the scripted first minute.
- `await shot('name')` (dev server only) renders one frame and saves it to `.shots/name.jpg` through a tiny Vite plugin.

## Performance notes

Target is 60 fps on integrated graphics; about 11 ms a frame at 1440×900 on an M-series laptop. Every species is one `InstancedMesh`, the sim is ~350 agents (under 1 ms), the sand/gravel mask is baked to a texture, and the orca, humpback and porpoise load after the reveal. Pixel ratio starts at 1.5 and steps down (never back up) if a machine can't hold ~48 fps. `prefers-reduced-motion` slows the scene; without WebGL 2 the portfolio shows as plain text.
