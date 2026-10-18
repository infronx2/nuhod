// Copies MediaPipe's WASM runtime from node_modules into public/play/wasm (run before each build),
// so the 26 MB of binaries are not kept in git. The web majlis (/play) loads them from there.
import fs from 'node:fs'
import path from 'node:path'

const src = path.join('node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const dst = path.join('public', 'play', 'wasm')
fs.mkdirSync(dst, { recursive: true })
for (const f of fs.readdirSync(src)) {
  if (f.startsWith('vision_wasm_internal') || f.startsWith('vision_wasm_nosimd_internal')) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f))
  }
}
console.log('copied MediaPipe wasm to', dst)
