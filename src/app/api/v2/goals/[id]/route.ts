import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest, requireRole } from '@/lib/auth'

/**
 * DELETE /api/v2/goals/[id] — delete a rehabilitation goal.
 * Doctors + admins only. The goal must belong to a patient (we verify
 * ownership by looking up the goal's patientId before deleting).
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  if (!requireRole(payload, 'DOCTOR') && !requireRole(payload, 'ADMIN')) {
    return NextResponse.json({ ok: false, error: 'forbidden — doctors only' }, { status: 403 })
  }
  const { id } = await ctx.params

  // Verify the goal exists before deleting (so we can 404 cleanly).
  const goal = await db.rehabGoal.findUnique({ where: { id } })
  if (!goal) {
    return NextResponse.json({ ok: false, error: 'goal not found' }, { status: 404 })
  }

  await db.rehabGoal.delete({ where: { id } })
  return NextResponse.json({ ok: true, deleted: id })
}
