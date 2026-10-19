import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'
import { canAccessPatient, isStaff } from '@/lib/access'

// GET /api/v2/patients/[id]/audit — who opened or changed this patient's records (doctor only).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  const { id } = await ctx.params
  if (!isStaff(payload) || !(await canAccessPatient(payload, id))) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  const rows = await db.auditLog.findMany({ where: { patientId: id }, orderBy: { createdAt: 'desc' }, take: 50 })
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))]
  const actors = await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, role: true } })
  const byId = new Map(actors.map((a) => [a.id, a]))
  return NextResponse.json({
    ok: true,
    entries: rows.map((r) => ({
      id: r.id, action: r.action, createdAt: r.createdAt,
      actor: r.actorId ? { name: byId.get(r.actorId)?.name ?? '—', role: byId.get(r.actorId)?.role ?? '' } : null,
    })),
  })
}
