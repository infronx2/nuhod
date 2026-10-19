/**
 * A small QR code encoder (byte mode, error correction level M, versions 1-9: up to 180 bytes),
 * enough for the sign-in links a doctor shows a patient. Follows ISO/IEC 18004; structure after
 * Project Nayuki's reference encoder. Returns rows of booleans (true = dark).
 */

// Level M per version: [error-correction codewords per block, [blocks, data codewords per block]...]
const BLOCKS: Array<[number, Array<[number, number]>]> = [
  [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]],
  [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]],
]
const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]

export function qrMatrix(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text))
  let version = 0
  // Versions 1-9 are checked against a decoder (OpenCV); longer text is refused rather than risked.
  for (let v = 1; v <= 9; v++) {
    const dataCap = BLOCKS[v - 1][1].reduce((s, [n, k]) => s + n * k, 0)
    if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCap * 8) { version = v; break }
  }
  if (!version) throw new Error('text too long for a QR code')
  const [ecLen, groups] = BLOCKS[version - 1]
  const dataCap = groups.reduce((s, [n, k]) => s + n * k, 0)

  // Bit stream: mode, count, bytes, terminator, padding.
  const bits: number[] = []
  const push = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  push(0b0100, 4)
  push(bytes.length, version < 10 ? 8 : 16)
  for (const b of bytes) push(b, 8)
  push(0, Math.min(4, dataCap * 8 - bits.length))
  push(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < dataCap * 8; pad ^= 0xec ^ 0x11) push(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))

  // Split into blocks, add Reed-Solomon codewords, interleave.
  const divisor = rsDivisor(ecLen)
  const blocks: Array<{ data: number[]; ecc: number[] }> = []
  let k = 0
  for (const [n, len] of groups) for (let i = 0; i < n; i++) {
    const d = data.slice(k, k + len)
    k += len
    blocks.push({ data: d, ecc: rsRemainder(d, divisor) })
  }
  const codewords: number[] = []
  const maxData = Math.max(...blocks.map((b) => b.data.length))
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) codewords.push(b.data[i])
  for (let i = 0; i < ecLen; i++) for (const b of blocks) codewords.push(b.ecc[i])

  const size = version * 4 + 17
  const modules = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
  const fixed = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
  const set = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; fixed[y][x] = true }

  // Function patterns: timing, finders, alignment, format and version areas.
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= size || y >= size) continue
      const d = Math.max(Math.abs(dx), Math.abs(dy))
      set(x, y, d !== 2 && d !== 4)
    }
  }
  const al = ALIGN[version - 1]
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }
  const drawFormat = (mask: number) => {
    const d = (0 << 3) | mask // level M = 0b00
    let rem = d
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const f = ((d << 10) | rem) ^ 0x5412
    const bit = (i: number) => ((f >>> i) & 1) === 1
    for (let i = 0; i <= 5; i++) set(8, i, bit(i))
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
    set(8, size - 8, true)
  }
  drawFormat(0)
  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const v = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const dark = ((v >>> i) & 1) === 1
      const a = size - 11 + (i % 3), b = Math.floor(i / 3)
      set(a, b, dark); set(b, a, dark)
    }
  }

  // Codewords in the zigzag, upward and downward column pairs from the right.
  let bitIndex = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j
      const upward = ((right + 1) & 2) === 0
      const y = upward ? size - 1 - vert : vert
      if (!fixed[y][x] && bitIndex < codewords.length * 8) {
        modules[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) === 1
        bitIndex++
      }
    }
  }

  // The mask with the lowest penalty.
  let best: boolean[][] | null = null
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const m = modules.map((row, y) => row.map((dark, x) => (fixed[y][x] ? dark : dark !== maskBit(mask, x, y))))
    const keep = modules.map((r) => [...r])
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) modules[y][x] = m[y][x]
    drawFormat(mask)
    const score = penalty(modules)
    if (score < bestScore) { bestScore = score; best = modules.map((r) => [...r]) }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) modules[y][x] = keep[y][x]
  }
  return best!
}

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0
    case 1: return y % 2 === 0
    case 2: return x % 3 === 0
    case 3: return (x + y) % 3 === 0
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  }
}

/** Runs of five or more, 2x2 blocks, finder-like patterns and dark/light balance (ISO rules N1-N4). */
function penalty(m: boolean[][]): number {
  const n = m.length
  let score = 0
  const finderLike = (line: boolean[]) => {
    let c = 0
    const s = line.map((d) => (d ? '1' : '0')).join('')
    for (const p of ['10111010000', '00001011101']) for (let i = s.indexOf(p); i >= 0; i = s.indexOf(p, i + 1)) c++
    return c
  }
  for (let pass = 0; pass < 2; pass++) for (let a = 0; a < n; a++) {
    const line = Array.from({ length: n }, (_, b) => (pass === 0 ? m[a][b] : m[b][a]))
    let run = 1
    for (let b = 1; b <= n; b++) {
      if (b < n && line[b] === line[b - 1]) run++
      else { if (run >= 5) score += run - 2; run = 1 }
    }
    score += finderLike(line) * 40
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const c = m[y][x]
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3
  }
  const dark = m.reduce((s, r) => s + r.filter(Boolean).length, 0)
  score += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10
  return score
}

function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function rsDivisor(degree: number): number[] {
  const result = Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < degree) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return result
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = Array<number>(divisor.length).fill(0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor) })
  }
  return result
}
