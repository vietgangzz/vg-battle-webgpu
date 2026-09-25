# VGANG Battle — real-time (React Native, WebGPU)

The Little Giant anime duel from `vg-showcase-demo/battle`, played in real time
on device: three.js (WebGPU renderer) on `react-native-webgpu` (Dawn), with every
shader written in TypeGPU (`"use gpu"` → WGSL). Full screen on any display —
phone, rotated, or an unfolded foldable — with the soundtrack as the clock and
the vgang end card.

Native only (iOS / Android). Needs a development build: `react-native-webgpu`
is not in Expo Go.

```sh
bun install
bunx expo run:ios        # or run:android
```

## How the port works

The Blender film is not re-animated here. `battle/export_rt.py` (in
vg-showcase-demo) samples it:

| Output | What |
|---|---|
| `assets/film/film.bin` | geometry, particle point clouds, and every per-frame track (transforms, visibility, shader params, lights, lens/focus, GN inputs, compositor knobs) |
| `src/battle/gen/film.json` | manifest for the above |
| `src/battle/gen/materials.ts` | all 107 Blender materials compiled to TypeGPU (`lib/tgpu_codegen.py`) |
| `src/battle/gen/particles.ts` | the geometry-node particle motions compiled to TypeGPU |

Re-export after changing the film:

```sh
cd ../vg-showcase-demo/battle
blender -b battle.blend -P export_rt.py -- --app ../../vg-battle-webgpu
```

Runtime (`src/battle/runtime/`):

| File | What |
|---|---|
| `blender.ts` | Blender node semantics in TypeGPU: safe math, map range, fBm Perlin noise, voronoi, layer weight |
| `lighting.ts` | Blender-unit light rig (suns, point lights, blob shadows), Lambert + GGX, volume scattering |
| `materials.ts` | generated shaders → three node materials: surfaces, ray-marched volumes, instanced particles |
| `scene.ts` | builds the scene from the export and poses it at any (fractional) frame; screen framing |
| `post.ts` | the Blender compositor: bloom, star streaks, exposure, lens, grade, invert, flash, vignette, FXAA, letterbox, DOF |
| `player.ts` | load, pipeline warm-up, 60 fps pacing, dynamic resolution |

Framing: the film is 16:9; on other screens the camera keeps a 4:3 safe area
fully visible and extends the view to fill the rest, and the letterbox bars
scale with it.

## Checking without a device

`tools/` renders with Dawn in Node — the same WebGPU engine the app uses on
device — through the app's own runtime:

```sh
node tools/run.mjs tools/check-lib.ts                                        # compile the noise library
node tools/run.mjs tools/render-frames.ts --frames 10,130,430 --size 1280x720
./tools/to-png.sh                                                            # -> tools/.out/frames/*.png
node tools/run.mjs tools/render-frames.ts --bench --size 2208x1768           # frame times over the film
node tools/run.mjs tools/render-frames.ts --raw --profile 240 --size 2208x1768  # GPU cost per object
```
