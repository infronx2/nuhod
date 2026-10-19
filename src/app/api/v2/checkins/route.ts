import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { audit } from '@/lib/audit'

/** Pain at or above this before a session: no session today, and the doctor is told. */
const PAIN_STOP_BEFORE = 7

// POST /api/v2/checkins — the patient's answers before a session. Body: { pain: 0-10, fatigue: 0-2 }
// Returns { ok, allowed }. A session that is not allowed alerts the patient's doctor.
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const pain = Math.round(Number(body?.pain))
  const fatigue = Math.round(Number(body?.fatigue))
  if (!(pain >= 0 && pain <= 10) || !(fatigue >= 0 && fatigue <= 2)) {
    return NextResponse.json({ ok: false, error: 'pain 0-10, fatigue 0-2' }, { status: 400 })
  }
  const allowed = pain < PAIN_STOP_BEFORE && fatigue < 2
  if (!allowed) {
    const me = await db.user.findUnique({ where: { id: payload.sub }, select: { name: true, doctorId: true } })
    if (me?.doctorId) {
      const { createNotification } = await import('@/lib/notifications')
      await createNotification({
        userId: me.doctorId,
        type: 'info',
        title: `${me.name}: ما بدأ جلسة اليوم`,
        body: `قبل الجلسة: الألم ${pain}/10، ${fatigue === 2 ? 'تعبان وايد' : fatigue === 1 ? 'تعبان شوي' : 'مرتاح'}.`,
        severity: 'warning',
        linkType: 'patient',
        linkId: payload.sub,
      })
    }
    await audit(req, { actorId: payload.sub, action: 'pain_alert', patientId: payload.sub, detail: `before: pain ${pain}, fatigue ${fatigue}` })
  }
  return NextResponse.json({ ok: true, allowed })
}
