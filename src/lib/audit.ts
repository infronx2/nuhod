/**
 * The audit trail of the trial: sign-ins, opening a patient's file, changes to plans, accounts and
 * measures, exports. Writing it never blocks or fails the request it describes.
 */
import { db } from '@/lib/db'

export type AuditAction =
  | 'login' | 'login_failed' | 'login_locked' | 'login_qr' | 'login_passkey'
  | 'passkey_added' | 'passkey_removed'
  | 'patient_created' | 'patient_viewed' | 'patient_updated' | 'pin_reset' | 'qr_issued'
  | 'plan_created' | 'measure_added' | 'measure_deleted' | 'consent_patient' | 'export' | 'pain_alert'

export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for')
  return (forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip'))?.trim() || null
}

export async function audit(
  req: Request | null,
  entry: { actorId?: string | null; action: AuditAction; patientId?: string | null; detail?: string | null },
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        patientId: entry.patientId ?? null,
        detail: entry.detail?.slice(0, 500) ?? null,
        ip: req ? clientIp(req) : null,
      },
    })
  } catch (err) {
    console.error('[audit] write failed', err)
  }
}
