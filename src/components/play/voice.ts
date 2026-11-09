/**
 * Mu'in's recorded lines (the same set as the Unreal game's ANuhoudVoice): one random line per event,
 * never the same one twice in a row, and no line over another unless it interrupts.
 */
import LINES from './voice-lines.json'

export class Voice {
  private audio = new Audio()
  private last = new Map<string, string>()
  private busyUntil = 0
  private unlocked = false
  muted = false

  /** iOS only plays audio started from a tap: call this from the start button. */
  unlock() {
    if (this.unlocked) return
    this.unlocked = true
    this.audio.src = '/play/voice/encourage_1.mp3'
    this.audio.volume = 0
    void this.audio.play().then(() => this.audio.pause()).catch(() => undefined).finally(() => { this.audio.volume = 1 })
  }

  say(event: string, interrupt = false) {
    if (this.muted) return
    const files = (LINES as Record<string, string[]>)[event]
    if (!files?.length) return
    if (!interrupt && performance.now() < this.busyUntil) return
    const options = files.length > 1 ? files.filter((f) => f !== this.last.get(event)) : files
    const file = options[Math.floor(Math.random() * options.length)]
    this.last.set(event, file)
    this.audio.pause()
    this.audio.src = `/play/voice/${file}`
    this.audio.volume = 1
    this.busyUntil = performance.now() + 4000
    this.audio.onloadedmetadata = () => { this.busyUntil = performance.now() + this.audio.duration * 1000 }
    void this.audio.play().catch(() => undefined)
  }

  /**
   * A sentence with no recorded clip yet (calibration, posture reminders): the device's own Arabic
   * voice, when it has one. Waits its turn behind a recorded line unless `interrupt`.
   */
  speak(text: string, interrupt = false) {
    if (this.muted || typeof speechSynthesis === 'undefined') return
    if (!interrupt && performance.now() < this.busyUntil) return
    const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('ar'))
    if (!voice) return
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.voice = voice
    u.lang = voice.lang
    u.rate = 0.95
    this.busyUntil = performance.now() + 3500
    speechSynthesis.speak(u)
  }

  stop() {
    this.audio.pause()
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  }
}
