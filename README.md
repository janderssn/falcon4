# Falcon 4

Blender models of the **Wills Wing Falcon 4 170** and an interactive Three.js
viewer that switches between two independent reconstructions.

![Falcon 4 viewer](docs/screenshots/viewer.png)

| Build | Parts | What it is |
|---|---|---|
| **Astra** | 669 | Round control frame, blue/red/off-white sail, resting ground configuration |
| **Opus** | 356 | Hardware matched to the owner's manual with part numbers (nose plate, keyhole tangs, crossbar junction, speedbar corners), batten strings and lever tips, reflex bridles, washout tubes |

Both builds use the same seven visibility groups. Some shapes and dimensions are
approximate. Don't use either model as a maintenance reference; use the Wills
Wing manual.

## Run the viewer

The viewer is published at **https://janderssn.github.io/falcon4/** on every push to `master`
(see [`.github/workflows/pages.yml`](.github/workflows/pages.yml)).

To run it locally:

Requires Node.js 22.12+ and a WebGL-capable browser. The models are included, so
you don't need Blender to run the viewer.

```sh
git clone https://github.com/janderssn/falcon4.git
cd falcon4
npm ci
npm run dev
```

Open **http://localhost:5180**. Add `?model=opus` or `?model=astra` to the URL to open a specific build.

The viewer is a glider configurator:

- **Compare** (top of the view buttons, `V`): shows the other build to the right of
  a divider you can drag, in the same pose and colours.
- **Settings** (gear, top right corner, `S`): pick the build (Astra or Opus), the colour
  profile (the Wills Wing colour picker's colours, or calibrated to the real cloth where
  measured: Blue 7304, Red 3125, White 170), turn the floor grid in the studio on or off,
  turn the shadows on or off, and turn film blur on or off: clear laminates show what is
  just behind them sharp and blur what is further away (off on phones by default).
- **Sail cloth:** each panel's material follows its fabric, matched to photos of the real
  cloth. Woven polyester (Dacron) is opaque with a plain resin finish; the MT cloths add a
  diamond ripstop of paired threads; the laminates are glossy film over an opaque scrim and
  X-ply (black in the "B" cloths), and the hazy film shows what is behind it. The studio light is Poly Haven's "Studio Small 09" HDRI (CC0).
- **Customize** (top right, `C`): colour the sail
  panels as in the Wills Wing Falcon colour picker - P1 leading edge, P2 forward, P3 middle,
  P4 trailing edge, P5 undersurface - with the Wills Wing fabric list for each
  panel (the clear and tinted laminates are see-through), plus the batten pockets;
  choose the frame finish; make the sail see-through to look at the frame; show or
  hide the wires and bridles, and the battens (the batten strings hide with the
  sail or the battens); label where each colour row goes on the glider, with the
  colour chosen in it. Each part is one line with its colour and fabric (and any extra
  cost); click a line to choose. *As built* (the first swatch in each list) restores the
  original colour. **Order form** lays the glider out as a printed order request with
  part numbers and the known prices. Colours are approximate and for
  show only; Wills Wing's own picker notes the same.
- **Pose** (bottom of the view): tail down, standing on the control bar, or nose
  down - resting on the keel, rocked over the basebar until the tail or the nose
  touches the ground, with the angle found from each model.
- **Scene** (bottom left): studio, hangar, or a hill with grass in the wind,
  where you can also set the time of day and the wind. The camera stays above the
  ground on the hill and inside the hangar; in the studio you can look up from below.
- **View** (bottom right): fly around (`F`), back to the start view (`N`), plan view
  from above (`T`), zoom. Drag to turn, right-drag to move, scroll to zoom.
- **Numpad** as in Blender: `1` front, `3` right, `7` top (with `Ctrl`: back, left,
  bottom), `9` the opposite side, `5` 2D/3D, `0` the start view, `2` `4` `6` `8` turn
  15°, `.` the selected part, `+` `-` zoom. The number row keeps switching scenes.
- Click a sail panel, the pockets or the frame (or its label) to choose its colour in a
  small picker right there; it stays open to try colours and closes with Esc or a click
  elsewhere.
- **Copy link to this glider** puts the whole configuration in the link: build,
  colours, scene, settings, time of day and camera.
- The viewer opens on the Opus build, magenta with Medium Blue P3 and P4, a graphite
  frame, resting tail down, seen from below the wing
  (`DEFAULTS` in [`viewer/main.js`](viewer/main.js)). **Reset** returns to these
  colours; *As built* in a row gives the build's original colour (`built` in the link).

```sh
npm run build     # Static site in viewer/dist/
npm run preview   # Preview at http://localhost:5181
```

## Model files

| | Astra | Opus |
|---|---|---|
| Blender | [models/astra/falcon4_170_astra.blend](models/astra/falcon4_170_astra.blend) | [models/opus/falcon4_170_opus.blend](models/opus/falcon4_170_opus.blend) |
| GLB (viewer) | [viewer/public/models/astra/model.glb](viewer/public/models/astra/model.glb) | [viewer/public/models/opus/model.glb](viewer/public/models/opus/model.glb) |
| Part groups | [parts.json](viewer/public/models/astra/parts.json) | [parts.json](viewer/public/models/opus/parts.json), generated by `node tools/make_parts.cjs opus` |

[`viewer/public/models.json`](viewer/public/models.json) lists the builds. Each
entry gives the GLB, the parts file, and an optional `rotateY` / `offset`. The
opus model is turned 180° so its nose points the same way as astra's. The viewer then
puts every build on the same floor: the point where the basebar touches the ground is
at y = 0, whatever the file's own origin, so the builds don't jump when you switch or
compare them. (The model repos have issues open to export in one shared frame, so this
correction and `rotateY` can go: janderssn/falcon4-astra#3, janderssn/falcon4-opus#11.)
To add another build, add an entry there.

Two other gliders from the same series of Opus models are in the list too: the
**Wills Wing Sport 3 155** ([janderssn/sport3-opus](https://github.com/janderssn/sport3-opus),
with its sail) and the **Tecma Medium 15**
([janderssn/tecma-opus](https://github.com/janderssn/tecma-opus)). Their entries add
`glider` and `subtitle` for the title. The colour picker and the order form are for the
Falcon 4 only.

Their GLBs are exported from the saved .blend and made small for the web with
`tools/optimize_glb.mjs`: each mesh is simplified until it (and each of its shape targets) would move by more than a set
distance (0.12 mm for the Sport 3, 0.2 mm for the Tecma), then quantized and
meshopt-compressed. This takes the Sport 3 from 77 MB to 17.3 MB (with its VG rig) and the Tecma from 136 MB
to 17.7 MB.

A build can have configurations. The Tecma's GLB keeps its "In flight" shape keys as morph
targets (exported at 0, rigged on the ground, with their drivers removed), and its entry in
`models.json` gives the weight per resting pose: `"poseShapes": { "bar": { "In flight": 1 } }`.
Standing shows it in flight; tail down and nose down show it parked. The weights swing with
the tilt. `node tools/make_parts.cjs sport3` (or `tecma`) writes the part groups.

A loose rope end can be soft. An entry in `"ropes"` names the part (the Sport 3's "VG lower
rope surplus"), where it leaves its cleat (`start`, `dir`), its `length` and `radius`, the
`colliders` it rests on, and the `lay` it starts from: the model's stowed shape, points
2.5 cm apart. All are in GLB coordinates. `viewer/lib/rope.js` redraws the part as a braided
tube on a chain of points under gravity. The rope drapes over the colliders and lies on the
floor, and it follows the glider when the pose changes.

Film over film: the picture of what lies behind a clear laminate (lib/frost.js) keeps the opaque parts
of the other film skin (stripes, woven panels, fibres), so a stripe on a film undersurface shows through a
film top. The pockets inside the undersurface are one tape in the undersurface's own cloth (P5). In the
picker's top drawings a zone of which under 5 % shows is left out (`tools/sail_designs.py`; set
`DESIGNS_OUT` to write a trial copy).

The Sport 3 is rigged for its VG (sport3-opus `tools/vg_rig.py`). Parts that move carry
keyframes (time 0 loose, end tight) through real builds at 25, 50 and 75 %, and parts that change
shape move with them and carry their bend as morph targets ("VG loose", "VG 0.5", and for the sail's skins "VG 0.25" and "VG 0.75" too; the viewer blends
from one setting's target to the next), so a tube stays in its end cap all the way. The VG slider in the pose bar (`?vg=0..1`, default 1, tight as modelled) sets
both. It also pays the rope surplus out from `lengthLoose` to `length`. The ropes that slide
through the VG blocks carry a route instead (`vg_route`: points held by the parts they touch),
and `RoutedRope` in `viewer/lib/rope.js` redraws them along it, so the falls stay straight.

A build can have sail designs (`"designs": "designs/sport3"`). The Sport 3 offers the Wills Wing
colour picker's designs for it: 3-panel, Woosh and Butterfly (Monarch), in Customize under *Sail
colours* (`?design=woosh&dz=P6:bright-yellow-5280`). `python3 tools/sail_designs.py`
downloads the picker's plan-view drawings and fabric lists, reads each zone's outline as vectors and
writes it to `viewer/public/designs/` (the 3-panel's stripes under the wing run straight to the tip, as on the real
sails, where the picker draws them tapering) in cloth coordinates (share of the half span, share of the
chord) as a signed distance field. `viewer/lib/designs.js`
works out the same coordinates per pixel on the 3D sail, so the edges stay sharp and smooth at any
zoom (the fields have mipmaps: from far off a pixel takes its share of each zone) and the design stays on
the cloth through the VG travel.

The chord is measured in parts, so that the drawing's panel edges land on the model's own: from the
leading edge to the rear edge of the leading-edge panel (where the model's other cloth starts, round the
tip too: the crescent on top, the undersurface's rounded end underneath), on to the seam where the
undersurface is sewn to the top (the undersurface's trailing edge on the bottom maps; on the top maps the
front edge of the trailing-edge panel P4, which starts at that seam), and from there to the trailing edge.
The leading-edge zone (P1) is the model's own leading-edge cloth. Past the last of the other cloth at the
tip, each band carries on to the tip at its share of the chord. A cloth has the same colours on both
faces: the top skin seen from below shows the top drawing (so a red top shows red through a clear
undersurface), and behind the undersurface that is P4, as the picker's bottom drawing has it.

Every seam between zones is drawn as a lap with a zigzag stitch (from `<design>-<side>-seams.json`),
standing proud of the cloth: the normal takes the slope of the lap and the thread from the seam's own
distances, softened to half a millimetre and faded out where it gets smaller than a pixel (a slope taken
from the drawn shades glints along every edge). The Sport 3's own seams, hems, pocket tapes, patches and
stitching are in its detail map (sport3-opus `s3/sail_detail.py`: base and normal texture on a second UV
set); the design's colour is multiplied with it, and the model's seams are then not drawn a second time.
A model without such a map gets them drawn as the design's are. Seams and the edges between the model's
parts are drawn on the cloth laid flat (the skins' first UV set, which the Sport 3 build lays out with a
minimum-stretch unwrap; `tools/sail_uv.mjs` does the same for a GLB exported with a plan projection), so
they follow it round the leading edge. No cloth is drawn blacker than black sailcloth (2 % reflectance):
the picker's black is #000000, which would leave the seams and the sail's shape invisible.
`tools/optimize_glb.mjs` keeps a sail's detail atlas at full size (other textures are shrunk to 1024 px).
The batten pockets and zipper tape take the colour of the cloth they are sewn to, and the clear laminates (UVPXB05 and the like) are
see-through with their scrim, glossy and with film blur, as on the Falcon: the undersurface and frame show through the top skin.

- `version` is added to the GLB and parts URLs (`?v=…`). Change it whenever you
  replace a model file, so browsers load the new file at once and don't use a
  cached copy.

The sail colour and frame finish choices find their parts by part or material name
(`ZONES` in [`viewer/main.js`](viewer/main.js)). The fabric names and screen colours in
[`viewer/lib/fabrics.js`](viewer/lib/fabrics.js) come from the Wills Wing colour picker
data (model type "Falcon"). The opus sail has its colours baked
into textures; the viewer keeps the texture's light and dark (seams, stitching) and
swaps the hue. The scene and glider-card pictures in `viewer/public/thumbs/` are
rendered from the viewer itself by `node tools/thumbs.mjs` (Playwright and Pillow;
start `npm run dev` first).

This repository contains the models, viewer and screenshots. The reconstruction
scripts, research documents and reference photographs are kept in separate
private repositories.

## Screenshots

### Airframe and rigging

![Airframe with the sail hidden](docs/screenshots/airframe.png)

### Nose assembly

![Nose assembly](docs/screenshots/nose-assembly.png)
