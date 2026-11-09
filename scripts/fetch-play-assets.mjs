// Downloads the web game's free (CC0) Poly Haven assets and packs them for phones and iPads.
//
//   node scripts/fetch-play-assets.mjs
//
// Models become one compressed .glb each (meshopt geometry, WebP textures at 1024 px) in
// public/play/assets/models; textures and the lighting HDRI land next to them. Every asset and its
// licence is listed in public/play/assets/CREDITS.md and in the README.
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'play', 'assets')
const CACHE = join(ROOT, '.asset-cache')
const UA = { 'User-Agent': 'nuhoud-asset-fetch/1.0' }

/** Poly Haven models used in the majlis (all CC0). */
const MODELS = ['Lantern_01', 'treasure_chest', 'brass_pot_01', 'throw_pillows_01', 'potted_plant_02']
/** Poly Haven textures (all CC0): maps fetched per texture. */
const TEXTURES = { beige_wall_001: ['Diffuse', 'nor_gl', 'arm'], wood_floor: ['Diffuse', 'nor_gl', 'arm'], fabric_pattern_07: ['nor_gl', 'arm'] }
/** Interior light for reflections on brass and porcelain (CC0). */
const HDRI = 'lebombo'

async function json(url) {
  const r = await fetch(url, { headers: UA })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}
async function download(url, file) {
  if (existsSync(file)) return
  const r = await fetch(url, { headers: UA })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, Buffer.from(await r.arrayBuffer()))
}

await mkdir(join(OUT, 'models'), { recursive: true })
await mkdir(join(OUT, 'textures'), { recursive: true })
await mkdir(join(OUT, 'env'), { recursive: true })

for (const id of MODELS) {
  const files = await json(`https://api.polyhaven.com/files/${id}`)
  const g = files.gltf['1k'].gltf
  const dir = join(CACHE, id)
  await download(g.url, join(dir, `${id}.gltf`))
  for (const [path, f] of Object.entries(g.include ?? {})) await download(f.url, join(dir, path))
  const glb = join(OUT, 'models', `${id}.glb`)
  execSync(`npx --yes @gltf-transform/cli@4 optimize "${join(dir, `${id}.gltf`)}" "${glb}" --compress meshopt --texture-compress webp --texture-size 1024`, { stdio: 'inherit' })
  console.log('model', id)
}

for (const [id, maps] of Object.entries(TEXTURES)) {
  const files = await json(`https://api.polyhaven.com/files/${id}`)
  for (const m of maps) {
    const f = files[m]?.['1k']?.jpg
    if (!f) throw new Error(`${id}: no 1k ${m}`)
    await download(f.url, join(OUT, 'textures', `${id}_${m.toLowerCase()}.jpg`))
  }
  console.log('texture', id)
}

const env = await json(`https://api.polyhaven.com/files/${HDRI}`)
await download(env.hdri['1k'].hdr.url, join(OUT, 'env', `${HDRI}_1k.hdr`))
console.log('hdri', HDRI)

if (process.argv.includes('--clean')) await rm(CACHE, { recursive: true, force: true })
