import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'

/**
 * POST /api/v2/notifications/[id]/read — mark a single notification as read.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const { id } = await ctx.params
  // Ensure the notification belongs to the user before updating.
  const notif = await db.notification.findUnique({ where: { id } })
  if (!notif || notif.userId !== payload.sub) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  }
  await db.notification.update({ where: { id }, data: { read: true } })
  return NextResponse.json({ ok: true })
}
