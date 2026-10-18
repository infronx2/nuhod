/**
 * The Omani majlis, ported from NuhoudMajlis.cpp: same room, rug, seating, table service, decor and
 * lights, built from primitives so it loads instantly on a phone. Positions use the Unreal layout
 * (see space.ts); ue() converts them.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { LAYOUT, ROOM, TABLE, lin, tablePoint, ue, ueRot } from './space'

const { halfX: HX, halfY: HY, ceiling: H, wall: W, windowBottom: WB, windowTop: WT, mattressHeight: MH, mattressDepth: MD } = ROOM

export function mat(color: THREE.Color, metalness = 0, roughness = 0.8, emissive?: THREE.Color): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, ...(emissive ? { emissive } : {}) })
}

export const MATERIALS = {
  brass: () => mat(lin(0.62, 0.46, 0.24), 1, 0.4),
  darkWood: () => mat(lin(0.09, 0.045, 0.02), 0, 0.55),
}

/** A box given its Unreal centre and size (depth forward, width right, height up). */
export function box(parent: THREE.Object3D, c: [number, number, number], s: [number, number, number], m: THREE.Material,
  rot: [number, number, number] = [0, 0, 0], opts: { cast?: boolean; receive?: boolean } = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(s[1], s[2], s[0]), m)
  mesh.position.copy(ue(...c))
  mesh.quaternion.copy(ueRot(...rot))
  mesh.castShadow = opts.cast ?? false
  mesh.receiveShadow = opts.receive ?? true
  parent.add(mesh)
  return mesh
}

/** A cylinder along the Unreal Z axis, given its centre and the size of its bounding box. */
export function cylinder(parent: THREE.Object3D, c: [number, number, number], s: [number, number, number], m: THREE.Material,
  rot: [number, number, number] = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 24), m)
  mesh.scale.set(s[1], s[2], s[0])
  mesh.position.copy(ue(...c))
  mesh.quaternion.copy(ueRot(...rot))
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

/** A rounded cushion (FNuhoudProceduralAssets::CreateRoundedBox). */
function cushion(parent: THREE.Object3D, c: [number, number, number], s: [number, number, number], m: THREE.Material,
  roundness: number, rot: [number, number, number] = [0, 0, 0]) {
  const r = Math.min(roundness, s[0] / 2 - 0.01, s[1] / 2 - 0.01, s[2] / 2 - 0.01)
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(s[1], s[2], s[0], 4, r), m)
  mesh.position.copy(ue(...c))
  mesh.quaternion.copy(ueRot(...rot))
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

/** A surface of revolution around the Unreal Z axis from (radius, height) points. */
export function lathe(points: Array<[number, number]>, m: THREE.Material, segments = 36): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(points.map(([r, z]) => new THREE.Vector2(r, z)), segments), m)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** Wooden plank texture drawn once on a canvas (the Unreal floor used a Starter Content wood). */
function plankTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 512
  const g = c.getContext('2d')!
  for (let i = 0; i < 8; i++) {
    const shade = 70 + ((i * 37) % 25)
    g.fillStyle = `rgb(${shade + 40}, ${shade + 5}, ${shade - 25})`
    g.fillRect(0, i * 64, 512, 64)
    g.fillStyle = 'rgba(0,0,0,0.35)'
    g.fillRect(0, i * 64, 512, 2)
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(40, 20, 8, ${0.05 + ((k * 13) % 7) / 100})`
      g.fillRect((k * 97 + i * 53) % 512, i * 64 + ((k * 29) % 60), 120, 1)
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(3, 3)
  return t
}

export function buildMajlis(scene: THREE.Scene, quality: 'high' | 'low') {
  const root = new THREE.Group()
  scene.add(root)
  const brass = MATERIALS.brass()
  const darkWood = MATERIALS.darkWood()

  // Ground outside and the wooden floor.
  box(root, [0, 0, -2], [6000, 6000, 1], mat(lin(0.6, 0.46, 0.3), 0, 1))
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.75 }))
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  root.add(floor)

  // Rug: layers 3 mm apart so their tops never coincide.
  const rug = (r: number, g: number, b: number) => mat(lin(r, g, b), 0, 0.95)
  const border = rug(0.07, 0.035, 0.025), red = rug(0.2, 0.035, 0.03), field = rug(0.14, 0.025, 0.025)
  const gold = rug(0.3, 0.19, 0.07), navy = rug(0.025, 0.035, 0.08)
  const cx = -10
  box(root, [cx, 0, 0.6], [470, 340, 1.2], border)
  box(root, [cx, 0, 1.0], [440, 310, 1.2], red)
  box(root, [cx, 0, 1.3], [370, 240, 1.2], field)
  box(root, [cx, 122, 1.6], [374, 4, 1.2], gold)
  box(root, [cx, -122, 1.6], [374, 4, 1.2], gold)
  box(root, [cx + 187, 0, 1.6], [4, 248, 1.2], gold)
  box(root, [cx - 187, 0, 1.6], [4, 248, 1.2], gold)
  box(root, [cx, 0, 1.6], [120, 120, 1.2], gold, [0, 45, 0])
  box(root, [cx, 0, 1.9], [80, 80, 1.2], navy, [0, 45, 0])
  box(root, [cx, 0, 2.2], [36, 36, 1.2], red, [0, 45, 0])
  for (const x of [-150, 150]) for (const y of [-85, 85]) box(root, [cx + x, y, 1.6], [30, 30, 1.2], navy, [0, 45, 0])

  // Walls: plaster, windows on the right and front walls, skirting and a frieze band.
  const plaster = mat(lin(0.58, 0.5, 0.39), 0, 0.9)
  const band = mat(lin(0.34, 0.25, 0.16), 0, 0.85)
  const zc = H / 2
  box(root, [-HX - W / 2, 0, zc], [W, 2 * (HY + W), H], plaster)
  box(root, [0, -HY - W / 2, zc], [2 * (HX + W), W, H], plaster)
  {
    const y = HY + W / 2, o0 = -20, o1 = 80, xMin = -HX - W, xMax = HX + W
    box(root, [(xMin + o0) / 2, y, zc], [o0 - xMin, W, H], plaster)
    box(root, [(o1 + xMax) / 2, y, zc], [xMax - o1, W, H], plaster)
    box(root, [(o0 + o1) / 2, y, WB / 2], [o1 - o0, W, WB], plaster)
    box(root, [(o0 + o1) / 2, y, (WT + H) / 2], [o1 - o0, W, H - WT], plaster)
    windowFrame(root, false, o0, o1, darkWood)
  }
  {
    const x = HX + W / 2
    const edges = [-HY - W, -150, -50, 50, 150, HY + W]
    for (let i = 0; i < 5; i++) {
      const y0 = edges[i], y1 = edges[i + 1], my = (y0 + y1) / 2
      if (i === 1 || i === 3) {
        box(root, [x, my, WB / 2], [W, y1 - y0, WB], plaster)
        box(root, [x, my, (WT + H) / 2], [W, y1 - y0, H - WT], plaster)
        windowFrame(root, true, y0, y1, darkWood)
      } else {
        box(root, [x, my, zc], [W, y1 - y0, H], plaster)
      }
    }
  }
  box(root, [-HX + 1, 0, 6], [2, 2 * HY, 12], darkWood)
  box(root, [HX - 1, 0, 6], [2, 2 * HY, 12], darkWood)
  box(root, [0, -HY + 1, 6], [2 * HX, 2, 12], darkWood)
  box(root, [0, HY - 1, 6], [2 * HX, 2, 12], darkWood)
  box(root, [-HX + 0.75, 0, 256], [1.5, 2 * HY, 10], band)
  box(root, [HX - 0.75, 0, 256], [1.5, 2 * HY, 10], band)
  box(root, [0, -HY + 0.75, 256], [2 * HX, 1.5, 10], band)
  box(root, [0, HY - 0.75, 256], [2 * HX, 1.5, 10], band)

  // Ceiling: palm-frond matting over palm-trunk beams.
  box(root, [0, 0, H + 10], [2 * (HX + W), 2 * (HY + W), 20], mat(lin(0.5, 0.38, 0.2), 0, 0.95))
  const beam = mat(lin(0.16, 0.09, 0.04), 0, 0.75)
  for (let i = 0; i < 11; i++) cylinder(root, [-HX + 25 + i * 55, 0, H - 7], [14, 14, 2 * HY], beam, [0, 0, 90])

  // Seating: the patient's mattress, guest seating along both side walls.
  const velvet = mat(lin(0.16, 0.025, 0.035), 0, 0.85)
  const green = mat(lin(0.035, 0.08, 0.055), 0, 0.85)
  const navyCloth = mat(lin(0.025, 0.035, 0.085), 0, 0.85)
  const goldCloth = mat(lin(0.3, 0.2, 0.07), 0, 0.65)
  const colours = [velvet, green, navyCloth]
  cushion(root, [-HX + MD / 2, 0, MH / 2], [MD, 440, MH], velvet, 4)
  for (let i = 0; i < 6; i++) cushion(root, [-HX + 10, -160 + i * 64, MH + 22], [18, 58, 44], colours[i % 3], 7, [8, 0, 0])
  for (const sign of [-1, 1]) {
    const y = sign * (HY - MD / 2)
    cushion(root, [0, y, MH / 2], [450, MD, MH], velvet, 4)
    cylinder(root, [0, y - sign * MD / 2, MH], [2.2, 2.2, 450], goldCloth, [90, 0, 0])
    for (let i = 0; i < 7; i++) {
      cushion(root, [-192 + i * 64, sign * (HY - 10), MH + 22], [58, 18, 44], colours[(i + 1) % 3], 7, [0, 0, -sign * 8])
    }
    for (const x of [-150, 0, 150]) cylinder(root, [x, sign * (HY - 35), MH + 12], [24, 24, 55], goldCloth, [0, 0, 90])
  }

  // Table: dark walnut so brass, porcelain and dates stand out; brass tray; glazed date bowl.
  const walnut = mat(lin(0.11, 0.055, 0.025), 0, 0.5)
  const top = new THREE.Mesh(new THREE.CylinderGeometry(TABLE.diameter / 2, TABLE.diameter / 2, 3, 48), walnut)
  top.position.copy(ue(TABLE.centerX, TABLE.centerY, TABLE.top - 1.5))
  top.receiveShadow = true
  root.add(top)
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(6, 9, TABLE.top - 3, 24), walnut)
  leg.position.copy(ue(TABLE.centerX, TABLE.centerY, (TABLE.top - 3) / 2))
  root.add(leg)
  const tray = lathe([[0, 0], [16, 0], [16.8, 0.5], [17.1, 1.8], [16.6, 2], [16, LAYOUT.trayTopZ], [0, LAYOUT.trayTopZ]], brass)
  tray.position.copy(tablePoint(LAYOUT.tray[0], LAYOUT.tray[1]))
  root.add(tray)
  const bowl = lathe([[0, 0], [3.2, 0], [3.5, 0.4], [6.5, 2.8], [8.4, 5.6], [8.6, 6], [8.1, 6], [6.1, 3.2], [3, LAYOUT.bowlFloorZ], [0, LAYOUT.bowlFloorZ]],
    mat(lin(0.03, 0.3, 0.36), 0, 0.2))
  bowl.position.copy(tablePoint(LAYOUT.bowl[0], LAYOUT.bowl[1]))
  root.add(bowl)

  // Decor: engraved brass plates, the mandoos chest, the incense burner and potted plants.
  const plate = [[0, 0], [22, 0], [22.6, 0.6], [22, 1.5], [19.5, 1.1], [17, 0.8], [8, 1.4], [4, 1], [0, 1.6]] as Array<[number, number]>
  for (const y of [-205, 205]) {
    const p = lathe(plate, brass)
    p.position.copy(ue(HX - 2, y, 150))
    p.quaternion.copy(ueRot(90, 0, 0))
    root.add(p)
  }
  const cxm = HX - 26
  box(root, [cxm, 0, 25], [48, 96, 50], darkWood)
  box(root, [cxm, 0, 53], [52, 100, 6], darkWood)
  for (const y of [-32, 0, 32]) box(root, [cxm - 24.5, y, 27], [1.2, 5, 52], brass)
  box(root, [cxm - 24.5, 0, 8], [1.2, 96, 4], brass)
  box(root, [cxm - 25, 0, 42], [1.5, 10, 12], brass)
  for (const z of [18, 34]) for (let k = 0; k < 11; k++) {
    const stud = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), brass)
    stud.position.copy(ue(cxm - 25, -44 + k * 8.8, z))
    root.add(stud)
  }
  const burner = new THREE.Group()
  burner.position.copy(ue(HX - 25, 80, 0))
  burner.add(lathe([[0, 0], [7, 0], [7, 2], [5.2, 3], [4, 10], [5.5, 12], [7.5, 14], [7.5, 16.5], [0, 16.5]], darkWood))
  burner.add(lathe([[7, 16], [7.9, 16.4], [7.9, 17.4], [7, 17.6]], brass))
  const ember = new THREE.Mesh(new THREE.IcosahedronGeometry(2, 1), mat(lin(0.3, 0.08, 0.02), 0, 0.9, new THREE.Color(1, 0.35, 0.08)))
  ember.position.y = 17.5
  burner.add(ember)
  const emberLight = new THREE.PointLight(0xff7a30, 400, 120, 2)
  emberLight.position.y = 22
  burner.add(emberLight)
  root.add(burner)
  const clay = mat(lin(0.42, 0.19, 0.09), 0, 0.85)
  const leaves = mat(lin(0.05, 0.16, 0.04), 0, 0.8)
  for (const y of [-215, 215]) {
    const pot = lathe([[0, 0], [9, 0], [11, 2], [14, 30], [15, 31], [15, 33], [13.5, 33], [0, 30]], clay)
    pot.position.copy(ue(HX - 35, y, 0))
    root.add(pot)
    for (let k = 0; k < 7; k++) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(18 - k, 1), leaves)
      leaf.position.copy(ue(HX - 35 + Math.sin(k * 2.1) * 12, y + Math.cos(k * 2.1) * 12, 50 + k * 8))
      leaf.scale.set(1, 0.8, 1)
      root.add(leaf)
    }
  }

  // Light: soft lamp over the table (its shadows put hands and objects in contact), a warm fill,
  // afternoon sun through the windows and a sky fill.
  const lamp = new THREE.SpotLight(0xffe1b8, 9000, 320, THREE.MathUtils.degToRad(32), 0.55, 2)
  lamp.position.copy(ue(TABLE.centerX - 10, 0, TABLE.top + 160))
  lamp.target.position.copy(ue(TABLE.centerX - 10, 0, 0))
  lamp.castShadow = true
  lamp.shadow.mapSize.set(quality === 'high' ? 1024 : 512, quality === 'high' ? 1024 : 512)
  lamp.shadow.bias = -0.0008
  lamp.shadow.radius = 4
  root.add(lamp, lamp.target)
  const fill = new THREE.PointLight(0xffd2a0, 30000, 900, 2)
  fill.position.copy(ue(-40, 0, 270))
  root.add(fill)
  const sun = new THREE.DirectionalLight(0xffd9a8, 1.1)
  sun.position.copy(ue(380, 260, 330))
  sun.target.position.copy(ue(-100, -60, 0))
  root.add(sun, sun.target)
  root.add(new THREE.HemisphereLight(0xfff1dd, 0x5a3a24, 0.55))

  return root
}

function windowFrame(root: THREE.Object3D, front: boolean, o0: number, o1: number, wood: THREE.Material) {
  const w = o1 - o0, mid = (o0 + o1) / 2, hw = WT - WB, zm = (WB + WT) / 2, depth = W / 2
  const at = (along: number, out: number, z: number): [number, number, number] =>
    front ? [HX + out, along, z] : [along, HY + out, z]
  const sz = (a: number, o: number, z: number): [number, number, number] => (front ? [o, a, z] : [a, o, z])
  box(root, at(mid, depth, WB - 3), sz(w + 12, W + 8, 6), wood)
  box(root, at(mid, depth, WT + 3), sz(w + 12, W + 8, 6), wood)
  box(root, at(o0 - 3, depth, zm), sz(6, W + 8, hw + 12), wood)
  box(root, at(o1 + 3, depth, zm), sz(6, W + 8, hw + 12), wood)
  for (let i = 1; i <= 2; i++) box(root, at(o0 + (w * i) / 3, depth, zm), sz(3, 4, hw), wood)
  box(root, at(mid, depth, zm + 20), sz(w, 4, 3), wood)
  // Bright sky beyond the glass.
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(w, hw), new THREE.MeshBasicMaterial({ color: 0xbfd9ec }))
  sky.position.copy(ue(...at(mid, W + 2, zm)))
  sky.quaternion.copy(ueRot(0, front ? 90 : 0, 0))
  if (!front) sky.rotateY(Math.PI)
  root.add(sky)
}
