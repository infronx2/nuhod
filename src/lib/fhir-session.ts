import type { RehabSession } from '@prisma/client'

const isGameSession = (s: Pick<RehabSession, 'source'>) => s.source.startsWith('ue5')

/** What the headline angle measures: the majlis game tracks shoulder elevation, the web tracker elbow flexion. */
export function sessionCodeText(s: Pick<RehabSession, 'source' | 'limb'>): string {
  return isGameSession(s)
    ? `Nuhoud majlis ${s.limb} upper-limb session (max shoulder elevation)`
    : `Nuhoud ${s.limb} elbow flexion rehab session`
}

/** FHIR Observation components for the majlis game's arm and hand measurements. */
export function gameComponents(s: RehabSession) {
  if (!isGameSession(s)) return []
  const quantity = (value: number, unit: string, code: string) => ({
    value,
    unit,
    system: 'http://unitsofmeasure.org',
    code,
  })
  return [
    { code: { text: 'Average Shoulder Elevation' }, valueQuantity: quantity(round1(s.avgShoulderAngle), 'degrees', 'deg') },
    { code: { text: 'Max Elbow Angle (180 = fully straight)' }, valueQuantity: quantity(round1(s.maxElbowROM), 'degrees', 'deg') },
    { code: { text: 'Best Grip Closure' }, valueQuantity: quantity(Math.round(s.gripClosureMax), '%', '%') },
    ...(s.pinchMinCm > 0
      ? [{ code: { text: 'Closest Thumb-Index Pinch' }, valueQuantity: quantity(round1(s.pinchMinCm), 'cm', 'cm') }]
      : []),
    { code: { text: 'Objects Picked Up With A Fist' }, valueInteger: s.graspCount },
    { code: { text: 'Objects Picked Up With A Pinch' }, valueInteger: s.pinchCount },
    { code: { text: 'Tasks Completed With Assistance' }, valueInteger: s.tasksAssisted },
    { code: { text: 'Ended With The Pain-Stop Button' }, valueBoolean: s.painStop },
  ]
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
