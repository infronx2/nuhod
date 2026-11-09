/**
 * The majlis's real-world assets: compressed glTF models, PBR textures and the interior HDRI in
 * public/play/assets (all free; see CREDITS.md). Everything loads after the room is already on
 * screen: an object built from primitives is swapped for its model once that model arrives, and
 * stays as it is if a file is missing, so the session never waits on, or breaks over, an asset.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

const BASE = '/play/assets'

/** Models the room uses, by file name in public/play/assets/models. */
export const MODEL_NAMES = ['Lantern_01', 'treasure_chest', 'brass_pot_01', 'throw_pillows_01', 'potted_plant_02', 'dallah'] as const
export type ModelName = (typeof MODEL_NAMES)[number]

const models = new Map<ModelName, THREE.Group>()
const waiters = new Map<ModelName, Array<(g: THREE.Group) => void>>()

/** A copy with its own materials, so one object's highlight never lights up its twins. */
function instance(src: THREE.Group): THREE.Group {
  const g = src.clone(true)
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone()
    m.castShadow = true
    m.receiveShadow = true
  })
  return g
}

/** Calls back with a fresh copy of the model as soon as it is loaded (now, if it already is). */
export function whenModel(name: ModelName, cb: (g: THREE.Group) => void) {
  const m = models.get(name)
  if (m) cb(instance(m))
  else waiters.set(name, [...(waiters.get(name) ?? []), cb])
}

let preload: Promise<void> | null = null

/** Loads every model once; a missing or broken file is skipped (its object keeps its primitive look). */
export function preloadModels(): Promise<void> {
  preload ??= (async () => {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    await Promise.all(MODEL_NAMES.map(async (name) => {
      try {
        const gltf = await loader.loadAsync(`${BASE}/models/${name}.glb`)
        models.set(name, gltf.scene)
        for (const cb of waiters.get(name) ?? []) cb(instance(gltf.scene))
        waiters.delete(name)
      } catch (e) {
        console.warn(`[play] model ${name} not loaded, keeping the built-in shape`, e)
      }
    }))
  })()
  return preload
}

/**
 * Scales a model so its height is `height` cm and stands it on y = 0, centred on x/z. Poly Haven
 * models are in metres; the room is in centimetres.
 */
export function fitHeight(g: THREE.Object3D, height: number) {
  g.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(g)
  const size = box.getSize(new THREE.Vector3())
  if (size.y <= 0) return g
  const s = height / size.y
  g.scale.multiplyScalar(s)
  const c = box.getCenter(new THREE.Vector3())
  g.position.set(-c.x * s, -box.min.y * s, -c.z * s)
  return g
}

// ── Textures ────────────────────────────────────────────────────────────────

const texLoader = new THREE.TextureLoader()
const textures = new Map<string, THREE.Texture>()
let maxAnisotropy = 4

export function setMaxAnisotropy(n: number) { maxAnisotropy = Math.min(8, n) }

/** One of the Poly Haven texture maps (diffuse, nor_gl, arm), tiling `repeat` times. */
export function texture(name: string, map: 'diffuse' | 'nor_gl' | 'arm', repeat: [number, number] = [1, 1]): THREE.Texture {
  const key = `${name}_${map}_${repeat.join('x')}`
  let t = textures.get(key)
  if (!t) {
    t = texLoader.load(`${BASE}/textures/${name}_${map}.jpg`)
    t.colorSpace = map === 'diffuse' ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(repeat[0], repeat[1])
    t.anisotropy = maxAnisotropy
    textures.set(key, t)
  }
  return t
}

/**
 * A PBR material from a Poly Haven set: colour (or a tint when the set has no colour map), normal
 * map, and the ARM map (ambient occlusion, roughness, metalness in R, G, B).
 */
export function pbr(name: string, repeat: [number, number], opts: { color?: THREE.Color; diffuse?: boolean; normalScale?: number; roughness?: number } = {}) {
  const arm = texture(name, 'arm', repeat)
  const m = new THREE.MeshStandardMaterial({
    color: opts.color ?? new THREE.Color(1, 1, 1),
    map: opts.diffuse === false ? null : texture(name, 'diffuse', repeat),
    normalMap: texture(name, 'nor_gl', repeat),
    normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
    aoMap: arm,
    aoMapIntensity: 0.8,
    roughnessMap: arm,
    roughness: opts.roughness ?? 1,
    metalnessMap: arm,
    metalness: 1,
  })
  return m
}

/** Velvet or cotton for the cushions: a tinted colour with the fabric's weave and a soft sheen. */
export function fabric(color: THREE.Color, repeat: [number, number], sheen = 0.8) {
  return new THREE.MeshPhysicalMaterial({
    color,
    normalMap: texture('fabric_pattern_07', 'nor_gl', repeat),
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughnessMap: texture('fabric_pattern_07', 'arm', repeat),
    roughness: 0.95,
    sheen,
    sheenRoughness: 0.45,
    sheenColor: color.clone().lerp(new THREE.Color(1, 1, 1), 0.35),
  })
}

// ── Lighting environment ────────────────────────────────────────────────────

/** The interior HDRI as the room's reflections (not its background: the majlis walls are around us). */
export async function loadEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, intensity: number) {
  try {
    const hdr = await new HDRLoader().loadAsync(`${BASE}/env/lebombo_1k.hdr`)
    hdr.mapping = THREE.EquirectangularReflectionMapping
    const pmrem = new THREE.PMREMGenerator(renderer)
    const env = pmrem.fromEquirectangular(hdr).texture
    pmrem.dispose()
    hdr.dispose()
    scene.environment = env
    scene.environmentIntensity = intensity
    scene.environmentRotation.set(0, Math.PI * 0.35, 0)
  } catch (e) {
    console.warn('[play] HDRI not loaded, keeping the generated room light', e)
  }
}
