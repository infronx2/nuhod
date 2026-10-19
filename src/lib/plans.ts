import { db } from '@/lib/db'

/** The plan every new patient starts with, so they can play before a doctor adjusts it. */
export const DEFAULT_PLAN = { targetAngle: 45, dailyRepGoal: 10, sessionsPerWeek: 5 } as const

export type Side = 'right' | 'left' | 'bilateral'
export const TARGET_LIMBS = ['upper_right', 'upper_left', 'bilateral'] as const
export type TargetLimb = (typeof TARGET_LIMBS)[number]

export function parseSide(v: unknown): Side | null {
  return v === 'right' || v === 'left' || v === 'bilateral' ? v : null
}

export function isTargetLimb(v: unknown): v is TargetLimb {
  return typeof v === 'string' && (TARGET_LIMBS as readonly string[]).includes(v)
}

export function sideToTargetLimb(side: string | null | undefined): TargetLimb {
  return side === 'left' ? 'upper_left' : side === 'bilateral' ? 'bilateral' : 'upper_right'
}

export function targetLimbToSide(limb: string): Side {
  return limb === 'upper_left' ? 'left' : limb === 'bilateral' ? 'bilateral' : 'right'
}

/**
 * Gives a newly registered patient the default plan under the clinic's first doctor, so the
 * majlis game has a target and a session length straight away. Returns null when the clinic
 * has no doctor yet.
 */
export async function createDefaultPlan(
  patient: { id: string; affectedSide: string; doctorId?: string | null },
  given?: { id: string; name: string },
) {
  // The patient's own doctor first; the clinic's first doctor only for an unlinked patient.
  const own = !given && patient.doctorId
    ? await db.user.findUnique({ where: { id: patient.doctorId }, select: { id: true, name: true } })
    : null
  const doctor = given ?? own ?? await db.user.findFirst({
    where: { role: 'DOCTOR', active: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  })
  if (!doctor) return null

  const plan = await db.treatmentPlan.create({
    data: {
      patientId: patient.id,
      doctorId: doctor.id,
      title: 'خطة البداية',
      targetLimb: sideToTargetLimb(patient.affectedSide),
      ...DEFAULT_PLAN,
    },
  })
  return { plan, doctor }
}
