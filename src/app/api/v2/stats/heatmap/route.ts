import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'

/**
 * GET /api/v2/stats/heatmap?patientId=X&weeks=12
 *
 * Returns a GitHub-style activity heatmap: for each of the last `weeks` weeks
 * (default 12), for each day of the week, the total reps done on that day.
 * Used by the doctor dashboard's activity-heatmap visualizer.
 *
 * Doctors can query any patientId (or omit for a global aggregate across all
 * their patients). Patients get only their own.
 *
 * Response shape:
 *   {
 *     ok: true,
 *     weeks: 12,
 *     startDate: "2026-07-21",
 *     cells: [
 *       { date: "2026-07-21", dayOfWeek: 1, reps: 0, sessions: 0 },
 *       ... (12 * 7 = 84 cells, oldest first)
 *     ],
 *     maxReps: 42  // for color scaling
 *   }
 */
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const url = new URL(req.url)
  const isDoctor = payload.role.toUpperCase() === 'DOCTOR' || payload.role.toUpperCase() === 'ADMIN'
  const weeks = Math.min(Math.max(parseInt(url.searchParams.get('weeks') || '12', 10) || 12, 4), 52)
  const patientIdParam = url.searchParams.get('patientId')

  // Build the "where" clause.
  let where: any
  if (patientIdParam) {
    if (isDoctor || patientIdParam === payload.sub) {
      where = { patientId: patientIdParam }
    } else {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }
  } else if (isDoctor) {
    // Doctors without a patientId get an aggregate across ALL patients.
    where = {}
  } else {
    where = { patientId: payload.sub }
  }

  // Compute the date range: last `weeks` weeks ending today, aligned to weeks
  // starting on Sunday (day 0).
  const today = new Date()
  today.setHours(23, 59, 59, 999)
  const start = new Date(today)
  start.setDate(start.getDate() - (weeks * 7 - 1))
  start.setHours(0, 0, 0, 0)

  const sessions = await db.rehabSession.findMany({
    where: {
      ...where,
      sessionDate: { gte: start, lte: today },
    },
    select: {
      sessionDate: true,
      totalReps: true,
    },
  })

  // Aggregate per calendar day.
  const byDay = new Map<string, { reps: number; sessions: number }>()
  for (const s of sessions) {
    const key = s.sessionDate.toISOString().slice(0, 10)
    const cur = byDay.get(key) ?? { reps: 0, sessions: 0 }
    cur.reps += s.totalReps
    cur.sessions += 1
    byDay.set(key, cur)
  }

  // Build the cell grid (oldest first, 7 rows × weeks cols).
  const cells: Array<{ date: string; dayOfWeek: number; reps: number; sessions: number }> = []
  let maxReps = 0
  for (let d = 0; d < weeks * 7; d++) {
    const date = new Date(start)
    date.setDate(start.getDate() + d)
    const key = date.toISOString().slice(0, 10)
    const agg = byDay.get(key) ?? { reps: 0, sessions: 0 }
    cells.push({
      date: key,
      dayOfWeek: date.getDay(),
      reps: agg.reps,
      sessions: agg.sessions,
    })
    if (agg.reps > maxReps) maxReps = agg.reps
  }

  return NextResponse.json({
    ok: true,
    weeks,
    startDate: start.toISOString().slice(0, 10),
    endDate: today.toISOString().slice(0, 10),
    cells,
    maxReps,
  })
}
