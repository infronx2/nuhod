/**
 * Who may see a patient's records: the patient, the doctor following them (User.doctorId), and
 * admins. A doctor sees only their own patients; every patient route goes through these checks.
 */
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { NeuromoveJwtPayload } from '@/lib/auth'

export function isStaff(payload: NeuromoveJwtPayload | null): boolean {
  const role = payload?.role.toUpperCase()
  return role === 'DOCTOR' || role === 'ADMIN'
}

export function isAdmin(payload: NeuromoveJwtPayload | null): boolean {
  return payload?.role.toUpperCase() === 'ADMIN'
}

/** The patients this staff member may list: their own, or all of them for an admin. */
export function staffPatientWhere(payload: NeuromoveJwtPayload): Prisma.UserWhereInput {
  return isAdmin(payload) ? { role: 'PATIENT' } : { role: 'PATIENT', doctorId: payload.sub }
}

/** Ids of the patients this staff member follows (for clinic-wide stats). */
export async function staffPatientIds(payload: NeuromoveJwtPayload): Promise<string[]> {
  const rows = await db.user.findMany({ where: staffPatientWhere(payload), select: { id: true } })
  return rows.map((r) => r.id)
}

/** True when the caller may read or change this patient's records. */
export async function canAccessPatient(payload: NeuromoveJwtPayload | null, patientId: string): Promise<boolean> {
  if (!payload || !patientId) return false
  if (payload.sub === patientId) return true
  if (!isStaff(payload)) return false
  const patient = await db.user.findUnique({ where: { id: patientId }, select: { role: true, doctorId: true } })
  if (!patient || patient.role !== 'PATIENT') return false
  return isAdmin(payload) || patient.doctorId === payload.sub
}
