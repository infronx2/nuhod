# Web game assets: sources and licences

Every asset in the web majlis is free to use. `scripts/fetch-play-assets.mjs` downloads the Poly Haven
files and compresses them (meshopt geometry, WebP textures at 1024 px) for phones and iPads.

## Poly Haven (CC0, public domain, no attribution required; credited with thanks)

| Asset | Type | Author | Source |
| --- | --- | --- | --- |
| Lantern 01 | model (the lantern the patient hangs) | Rajil Jose Macatangay | https://polyhaven.com/a/Lantern_01 |
| Treasure Chest | model (the mandoos chest) | Rico Cilliers | https://polyhaven.com/a/treasure_chest |
| Brass Pot 01 | model (decor) | Rico Cilliers | https://polyhaven.com/a/brass_pot_01 |
| Throw Pillows 01 | model (cushions) | Serhii Khromov | https://polyhaven.com/a/throw_pillows_01 |
| Potted Plant 02 | model (plants) | Rico Cilliers | https://polyhaven.com/a/potted_plant_02 |
| Beige Wall 001 | texture (plaster walls) | Dimitrios Savva, Rico Cilliers | https://polyhaven.com/a/beige_wall_001 |
| Wood Floor | texture (floor, table) | Dimitrios Savva | https://polyhaven.com/a/wood_floor |
| Fabric Pattern 07 | texture (weave of the rug, cushions and sleeve) | Rob Tuytel | https://polyhaven.com/a/fabric_pattern_07 |
| Lebombo | HDRI (interior light and reflections) | Greg Zaal | https://polyhaven.com/a/lebombo |

Licence: https://polyhaven.com/license (CC0 1.0).

## Sketchfab (CC BY 4.0, attribution required)

| Asset | Author | Source | Licence |
| --- | --- | --- | --- |
| Dallah - Arabian Coffee pot (`models/dallah.glb`) | CGDELUXE | https://sketchfab.com/3d-models/dallah-arabian-coffee-pot-1aa080b38eb142688b14e49dc8701ae0 | https://creativecommons.org/licenses/by/4.0/ |

The model was compressed and its display base removed; the dallah is otherwise unchanged. Until the
file is in place the game uses its built-in dallah.

## Sketchfab (CC BY-SA 4.0, attribution and share-alike required)

| Asset | Author | Source | Licence |
| --- | --- | --- | --- |
| Rigged hand (`models/hand_realistic.glb`) | Elena FF | https://sketchfab.com/3d-models/rigged-hand-eae97cc2a742413cb5338ab942b12c1e | https://creativecommons.org/licenses/by-sa/4.0/ |

Changes: the scene's light and camera were removed and the file was compressed; the game mirrors it
for the left hand and tints its material. This modified model is shared under the same CC BY-SA 4.0
licence. The rest of the game's code and assets keep their own licences.

## Other assets already in the game

- Hands: WebXR Input Profiles generic hand meshes, MIT, © 2019 Amazon (`public/play/hands/LICENSE.md`).
- Pose and hand tracking models: Google MediaPipe, Apache 2.0 (`public/play/models/NOTICE.txt`).
- The rug's sadu weave, the sky, the finjan, the dates and the dishdasha sleeve are drawn in code (`src/components/play`).
