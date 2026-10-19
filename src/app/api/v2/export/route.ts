import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { isStaff, staffPatientWhere } from '@/lib/access'
import { audit } from '@/lib/audit'

// GET /api/v2/export?kind=sessions|measures: the doctor's trial data as CSV for analysis.
// Patients appear as P001, P002... in the order they joined; no names, usernames or emails.
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  if (!isStaff(payload)) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  const kind = req.nextUrl.searchParams.get('kind') === 'measures' ? 'measures' : 'sessions'

  const patients = await db.user.findMany({
    where: staffPatientWhere(payload), orderBy: { createdAt: 'asc' },
    select: { id: true, affectedSide: true, dateOfBirth: true, createdAt: true },
  })
  const code = new Map(patients.map((p, i) => [p.id, `P${String(i + 1).padStart(3, '0')}`]))
  const info = new Map(patients.map((p) => [p.id, p]))
  const ids = patients.map((p) => p.id)

  let header: string[]
  let rows: Array<Array<string | number | boolean | null>>
  if (kind === 'sessions') {
    const sessions = await db.rehabSession.findMany({ where: { patientId: { in: ids } }, orderBy: { sessionDate: 'asc' } })
    header = ['patient', 'affected_side', 'birth_year', 'session_date', 'source', 'limb', 'duration_s', 'tasks', 'correct',
      'max_angle_camera_deg', 'avg_shoulder_deg', 'max_elbow_rom_deg', 'grip_closure_max_pct', 'pinch_min_cm', 'grasps', 'pinches',
      'tasks_assisted', 'pain_before', 'fatigue_before', 'pain_after', 'pain_stop', 'score']
    rows = sessions.map((s) => [
      code.get(s.patientId)!, info.get(s.patientId)?.affectedSide ?? '', info.get(s.patientId)?.dateOfBirth?.slice(0, 4) ?? '',
      s.sessionDate.toISOString(), s.source, s.limb, s.durationSeconds, s.totalReps, s.correctReps,
      round(s.maxAchievedAngle), round(s.avgShoulderAngle), round(s.maxElbowROM), round(s.gripClosureMax), round(s.pinchMinCm),
      s.graspCount, s.pinchCount, s.tasksAssisted, s.painBefore, s.fatigueBefore, s.painAfter, s.painStop, s.gamificationScore,
    ])
  } else {
    const measures = await db.outcomeMeasure.findMany({ where: { patientId: { in: ids } }, orderBy: { measuredAt: 'asc' } })
    header = ['patient', 'affected_side', 'measured_at', 'timepoint', 'instrument', 'side', 'value', 'notes']
    rows = measures.map((m) => [
      code.get(m.patientId)!, info.get(m.patientId)?.affectedSide ?? '', m.measuredAt.toISOString(), m.timepoint, m.instrument,
      m.side, m.value, m.notes,
    ])
  }
  await audit(req, { actorId: payload.sub, action: 'export', detail: `${kind}: ${rows.length} rows` })
  // A byte-order mark so Excel opens Arabic notes correctly.
  const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="nuhoud-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  })
}

function round(n: number) { return Math.round(n * 10) / 10 }

function cell(v: string | number | boolean | null | undefined) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  // Quote anything with separators, and neutralise formulas a spreadsheet would run.
  const safe = /^[=+\-@]/.test(s) && typeof v === 'string' ? `'${s}` : s
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
