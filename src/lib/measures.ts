/** The standard clinical measures a doctor records by hand during the trial, with valid ranges. */
export const INSTRUMENTS = {
  fma_ue: { min: 0, max: 66, step: 1, sided: false },
  bbt: { min: 0, max: 150, step: 1, sided: true },
  mas: { min: 0, max: 4, step: 0.5, sided: true },
  gonio_shoulder_flexion: { min: 0, max: 180, step: 1, sided: true },
  gonio_elbow_extension: { min: 0, max: 180, step: 1, sided: true },
  pain_nrs: { min: 0, max: 10, step: 1, sided: false },
} as const

export type Instrument = keyof typeof INSTRUMENTS
export const TIMEPOINTS = ['baseline', 'mid', 'end', 'other'] as const
export type Timepoint = (typeof TIMEPOINTS)[number]

export function isInstrument(v: unknown): v is Instrument {
  return typeof v === 'string' && v in INSTRUMENTS
}
