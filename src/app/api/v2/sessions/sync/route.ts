import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { awardBadges } from '@/lib/badges'
import { createNotification, notifyBadgesEarned } from '@/lib/notifications'

/**
 * POST /api/v2/sessions/sync
 *
 * System-to-system endpoint used by the Python pose-server to auto-persist
 * a completed WebSocket tracking session to the Next.js DB. This means
 * live-camera sessions are recorded even when the UE5/browser client never
 * calls POST /api/v2/sessions manually (e.g. if the patient closes the
 * app mid-session).
 *
 * Auth: a shared `X-Nuhoud-Key` header (the dev secret is deterministic;
 * production rotates via env). NOT a JWT — the pose-server doesn't hold
 * patient credentials, so it authenticates as a trusted internal service.
 *
 * Body: {
 *   patient_id: string,         // the patient who ran the session
 *   plan_id?: string,
 *   source: "live" | "demo",
 *   limb: "right" | "left",
 *   duration_seconds: number,
 *   total_reps: number,
 *   correct_reps: number,
 *   max_achieved_angle: number,
 *   compensation_errors: number,
 *   gamification_score: number,
 *   angle_timeline?: number[],
 * }
 */
const SYNC_API_KEY = process.env.NUHOUD_SYNC_API_KEY || 'nuhoud-internal-sync-dev-7f3a9e1b'

export async function POST(req: NextRequest) {
  const key = req.headers.get('x-nuhoud-key')
  if (!key || key !== SYNC_API_KEY) {
    return NextResponse.json({ ok: false, error: 'invalid sync key' }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }

  const patientId = String(body.patient_id || '').trim()
  if (!patientId) {
    return NextResponse.json(
      { ok: false, error: 'patient_id is required' },
      { status: 400 },
    )
  }

  const patient = await db.user.findUnique({ where: { id: patientId } })
  if (!patient) {
    return NextResponse.json({ ok: false, error: 'patient not found' }, { status: 404 })
  }

  const session = await db.rehabSession.create({
    data: {
      patientId,
      planId: body.plan_id || null,
      source: String(body.source || 'live'),
      limb: String(body.limb || patient.affectedSide || 'right'),
      durationSeconds: clampInt(body.duration_seconds, 0, 86400, 0),
      totalReps: clampInt(body.total_reps, 0, 100000, 0),
      correctReps: clampInt(body.correct_reps, 0, 100000, 0),
      maxAchievedAngle: Number(body.max_achieved_angle) || 0,
      compensationErrors: clampInt(body.compensation_errors, 0, 100000, 0),
      gamificationScore: clampInt(body.gamification_score, 0, 1000000, 0),
      angleTimeline: Array.isArray(body.angle_timeline)
        ? JSON.stringify(body.angle_timeline.slice(0, 5000))
        : null,
    },
  })

  // Award gamification badges + emit notifications (same as the manual-save path).
  const newBadges = await awardBadges(patientId)
  await createNotification({
    userId: patientId,
    type: 'session_saved',
    title: 'Live session synced',
    body: `${session.totalReps} reps, ${session.maxAchievedAngle.toFixed(0)}° max ROM, score ${session.gamificationScore}. Auto-saved from the camera.`,
    severity: 'success',
    linkType: 'session',
    linkId: session.id,
  })
  if (newBadges.length > 0) {
    await notifyBadgesEarned(patientId, newBadges.map((b) => b.slug))
  }

  return NextResponse.json({
    ok: true,
    session,
    newBadges: newBadges.map((b) => b.slug),
    synced: true,
  })
}

function clampInt(v: unknown, lo: number, hi: number, def: number): number {
  const n = typeof v === 'number' ? v : def
  if (!Number.isFinite(n)) return def
  return Math.max(lo, Math.min(hi, Math.round(n)))
}
