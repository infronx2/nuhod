import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { CONSENT_VERSION } from '@/lib/patient-accounts'

// POST /api/v2/me/consent — the patient agreed to the information screen in the app.
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  const user = await db.user.update({ where: { id: payload.sub }, data: { patientConsentAt: new Date() } })
  await audit(req, { actorId: user.id, action: 'consent_patient', patientId: user.id, detail: CONSENT_VERSION })
  return NextResponse.json({ ok: true, patientConsentAt: user.patientConsentAt })
}
