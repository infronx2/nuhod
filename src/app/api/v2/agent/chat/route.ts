import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { canAccessPatient, isStaff, staffPatientIds, staffPatientWhere } from '@/lib/access'
import { runMuin } from '@/lib/muin/agent'
import type { MuinMode } from '@/lib/muin/tools'

// Cost control (DeepSeek bills every token resent with each message):
// the last few turns only, a cache of identical questions, and daily caps.
const MAX_HISTORY = 6
const DAILY_LIMIT_PATIENT = Number(process.env.MUIN_DAILY_LIMIT_PATIENT || 20)
const DAILY_LIMIT_DOCTOR = Number(process.env.MUIN_DAILY_LIMIT_DOCTOR || 40)
const DAILY_LIMIT_TOTAL = Number(process.env.MUIN_DAILY_LIMIT_TOTAL || 300)
const OFFLINE_PREFIXES = ['مُعين غير متصل', "Mu'in is offline"]

/**
 * POST /api/v2/agent/chat — talk to Mu'in (مُعين), see src/lib/muin/agent.ts.
 *
 * Body: { message: string, patientId?: string }
 * - A patient talks about their own rehab (patientId is ignored unless it is their own).
 * - A doctor with patientId asks about that patient and may get a plan proposal to approve.
 * - A doctor without patientId asks about the whole roster; that thread is stored under the
 *   doctor's own id.
 *
 * The conversation is persisted in ChatMessage per (speaker, patient). A question asked again
 * before the patient's data changed gets the stored answer without calling the model, and past
 * the daily limits Mu'in answers from the data only.
 * Returns: { ok, reply, toolsUsed, proposal, source }
 */
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }
  const message = String(body?.message || '').trim()
  if (!message) {
    return NextResponse.json({ ok: false, error: 'message is required' }, { status: 400 })
  }
  if (message.length > 2000) {
    return NextResponse.json({ ok: false, error: 'message too long (max 2000 chars)' }, { status: 400 })
  }

  const role = payload.role.toUpperCase()
  const isDoctor = role === 'DOCTOR' || role === 'ADMIN'
  let mode: MuinMode
  let patientId: string | null
  if (isDoctor) {
    patientId = body.patientId ? String(body.patientId) : null
    mode = patientId ? 'doctor_patient' : 'doctor_roster'
    if (patientId && !(await canAccessPatient(payload, patientId))) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }
  } else {
    if (body.patientId && String(body.patientId) !== payload.sub) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }
    patientId = payload.sub
    mode = 'patient'
  }

  let preferArabic = true
  if (patientId) {
    const patient = await db.user.findUnique({ where: { id: patientId }, select: { role: true, preferredDialect: true } })
    if (!patient || patient.role !== 'PATIENT') {
      return NextResponse.json({ ok: false, error: 'patient not found' }, { status: 404 })
    }
    preferArabic = mode !== 'patient' || patient.preferredDialect !== 'english'
  }
  const threadId = patientId ?? payload.sub

  const recent = await db.chatMessage.findMany({
    where: { speakerId: payload.sub, patientId: threadId },
    orderBy: { createdAt: 'desc' },
    take: MAX_HISTORY,
  })
  const history = recent
    .reverse()
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 2000) }))

  const cached = mode === 'doctor_patient' ? null : await cachedAnswer(payload.sub, threadId, patientId, message)
  const result = cached
    ? { reply: cached, toolsUsed: [], proposal: null, source: 'deepseek' as const }
    : await runMuin({ mode, patientId, doctorId: role === 'DOCTOR' ? payload.sub : null, history, message, preferArabic, allowModel: await underDailyLimits(payload.sub, isDoctor) })

  try {
    await db.chatMessage.createMany({
      data: [
        { speakerId: payload.sub, patientId: threadId, role: 'user', content: message },
        { speakerId: payload.sub, patientId: threadId, role: 'assistant', content: result.reply },
      ],
    })
  } catch (err) {
    console.warn('[agent/chat] persist failed', err)
  }

  return NextResponse.json({
    ok: true,
    reply: result.reply,
    toolsUsed: result.toolsUsed,
    proposal: result.proposal,
    source: result.source,
  })
}

/**
 * DELETE /api/v2/agent/chat?patientId=X — clear the caller's conversation about X (or their own
 * thread without patientId).
 */
export async function DELETE(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const patientId = new URL(req.url).searchParams.get('patientId')
  const isDoctor = payload.role.toUpperCase() === 'DOCTOR' || payload.role.toUpperCase() === 'ADMIN'
  const threadId = patientId && isDoctor ? patientId : payload.sub
  const result = await db.chatMessage.deleteMany({ where: { speakerId: payload.sub, patientId: threadId } })
  return NextResponse.json({ ok: true, deleted: result.count })
}

const normalize = (t: string) => t.replace(/[\s؟?!.،,]+/g, ' ').trim().toLowerCase()

/**
 * The stored answer to the same question in this thread, if nothing it could depend on changed
 * since (a new session or plan for the patient, or for anyone in a roster thread) and it is from
 * the last 12 hours.
 */
async function cachedAnswer(speakerId: string, threadId: string, patientId: string | null, message: string) {
  const since = new Date(Date.now() - 12 * 3_600_000)
  const [latestSession, latestPlan] = await Promise.all([
    db.rehabSession.findFirst({ where: patientId ? { patientId } : {}, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    db.treatmentPlan.findFirst({ where: patientId ? { patientId } : {}, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
  ])
  const fresh = new Date(Math.max(since.getTime(), latestSession?.createdAt.getTime() ?? 0, latestPlan?.updatedAt.getTime() ?? 0))
  const rows = await db.chatMessage.findMany({
    where: { speakerId, patientId: threadId, createdAt: { gt: fresh } },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })
  const want = normalize(message)
  for (let i = rows.length - 2; i >= 0; i--) {
    const q = rows[i], a = rows[i + 1]
    if (q.role === 'user' && a.role === 'assistant' && normalize(q.content) === want && !OFFLINE_PREFIXES.some((p) => a.content.startsWith(p))) {
      return a.content
    }
  }
  return null
}

/** False once this user, or everyone together, used today's model replies. */
async function underDailyLimits(speakerId: string, isDoctor: boolean) {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const [mine, total] = await Promise.all([
    db.chatMessage.count({ where: { speakerId, role: 'user', createdAt: { gte: today } } }),
    db.chatMessage.count({ where: { role: 'user', createdAt: { gte: today } } }),
  ])
  return mine < (isDoctor ? DAILY_LIMIT_DOCTOR : DAILY_LIMIT_PATIENT) && total < DAILY_LIMIT_TOTAL
}
