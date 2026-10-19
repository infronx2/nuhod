import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { canAccessPatient, isStaff } from '@/lib/access'
import { audit } from '@/lib/audit'
import { INSTRUMENTS, TIMEPOINTS, isInstrument } from '@/lib/measures'

// GET /api/v2/patients/[id]/measures — the patient's hand-taken clinical measures (doctor only).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  const { id } = await ctx.params
  if (!isStaff(payload) || !(await canAccessPatient(payload, id))) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  const measures = await db.outcomeMeasure.findMany({ where: { patientId: id }, orderBy: { measuredAt: 'desc' }, take: 300 })
  return NextResponse.json({ ok: true, measures })
}

// POST — Body: { instrument, value, side?, timepoint?, measuredAt?, notes? }
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  const { id } = await ctx.params
  if (!isStaff(payload) || !(await canAccessPatient(payload, id))) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  if (!isInstrument(body?.instrument)) return NextResponse.json({ ok: false, error: 'unknown instrument' }, { status: 400 })
  const spec = INSTRUMENTS[body.instrument as keyof typeof INSTRUMENTS]
  const value = Number(body.value)
  if (!Number.isFinite(value) || value < spec.min || value > spec.max) {
    return NextResponse.json({ ok: false, error: `value must be ${spec.min}-${spec.max}` }, { status: 400 })
  }
  const measuredAt = body.measuredAt ? new Date(body.measuredAt) : new Date()
  const measure = await db.outcomeMeasure.create({
    data: {
      patientId: id,
      recordedById: payload.sub,
      instrument: body.instrument,
      value,
      side: spec.sided && (body.side === 'right' || body.side === 'left') ? body.side : null,
      timepoint: (TIMEPOINTS as readonly string[]).includes(body.timepoint) ? body.timepoint : 'other',
      measuredAt: Number.isNaN(measuredAt.getTime()) ? new Date() : measuredAt,
      notes: typeof body.notes === 'string' ? body.notes.slice(0, 500) : null,
    },
  })
  await audit(req, { actorId: payload.sub, action: 'measure_added', patientId: id, detail: `${measure.instrument}=${measure.value}` })
  return NextResponse.json({ ok: true, measure })
}

// DELETE ?measureId= — remove a mistaken entry.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  const { id } = await ctx.params
  if (!isStaff(payload) || !(await canAccessPatient(payload, id))) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  const measureId = req.nextUrl.searchParams.get('measureId') || ''
  const { count } = await db.outcomeMeasure.deleteMany({ where: { id: measureId, patientId: id } })
  if (count) await audit(req, { actorId: payload.sub, action: 'measure_deleted', patientId: id, detail: measureId })
  return NextResponse.json({ ok: true, removed: count })
}
