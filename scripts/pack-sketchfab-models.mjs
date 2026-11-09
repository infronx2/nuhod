// Packs the two Sketchfab models (CC BY / CC BY-SA, see public/play/assets/CREDITS.md) for the web game.
//
//   node scripts/pack-sketchfab-models.mjs <rigged_hand.glb> <dallah.glb>
//
// The hand keeps its skin and bones; the scene's light and camera are dropped. The dallah loses its
// display plate (the small separate mesh). Both get meshopt geometry and WebP textures.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup, meshopt, textureCompress, getBounds } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'play', 'assets', 'models')
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
await MeshoptEncoder.ready

async function pack(src, out, edit, size) {
  const doc = await io.read(src)
  await edit(doc)
  await doc.transform(
    prune(), dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 88 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  )
  await io.write(join(OUT, out), doc)
  console.log('wrote', out)
}

const [hand, dallah] = process.argv.slice(2)

await pack(hand, 'hand_realistic.glb', (doc) => {
  for (const n of doc.getRoot().listNodes()) {
    if (/^(Light|Camera)$/.test(n.getName())) n.dispose()
  }
}, 2048)

await pack(dallah, 'dallah.glb', (doc) => {
  // The display plate is the smaller of the two meshes; the pot itself is the textured one.
  const scene = doc.getRoot().getDefaultScene()
  for (const n of doc.getRoot().listNodes()) {
    const m = n.getMesh()
    if (!m) continue
    const textured = m.listPrimitives().some((p) => p.getMaterial()?.getBaseColorTexture())
    if (!textured) { console.log('dallah: dropping', m.getName(), JSON.stringify(getBounds(n))); n.dispose() }
  }
  console.log('dallah bounds', JSON.stringify(getBounds(scene)))
}, 1024)
