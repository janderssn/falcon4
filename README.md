# Falcon 4

A Blender model of the **Wills Wing Falcon 4 170** and an interactive Three.js viewer.

![Falcon 4 viewer](docs/screenshots/viewer.png)

The model represents a round control frame, blue/red/off-white sail and resting ground configuration. Its 391 parts are organized into seven visibility groups. Some shapes and dimensions are approximate.

## Run the viewer

Requires Node.js 22.12+ and a WebGL-capable browser. The model is included; no Blender installation is needed to run the viewer.

```sh
git clone https://github.com/janderssn/falcon4.git
cd falcon4
npm ci
npm run dev
```

Open **http://localhost:5180**.

- Drag to orbit, right-drag to pan, and scroll to zoom.
- Click a part to identify it; double-click to focus.
- Switch viewpoints and inspect connections using the sidebar.
- Toggle sail, frame, battens, wires, hardware and webbing separately.
- Save a viewport PNG or download the GLB.

```sh
npm run build     # Static site in viewer/dist/
npm run preview   # Preview at http://localhost:5181
```

## Model files

- [Blender model](models/hang_glider.blend) — editable native file for Blender 4.5 LTS.
- [GLB model](viewer/public/model.glb) — portable mesh model used by the viewer.
- [Part groups](viewer/public/parts.json) — maps model parts to viewer visibility groups.

This repository contains the model, viewer and screenshots. Reconstruction scripts, research documents and reference photographs are not included.

## Screenshots

### Airframe and rigging

![Airframe with the sail hidden](docs/screenshots/airframe.png)

### Nose assembly

![Nose assembly](docs/screenshots/nose-assembly.png)
