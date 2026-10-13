import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'

/**
 * GET /api/v2/notifications?limit=20&userId=X — list notifications.
 * By default returns the current user's notifications. Doctors can pass
 * `userId` to view a specific patient's notification feed (used by the
 * patient-detail progress timeline).
 */
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10) || 30, 100)
  const isDoctor = payload.role.toUpperCase() === 'DOCTOR' || payload.role.toUpperCase() === 'ADMIN'
  const userIdParam = url.searchParams.get('userId')
  // Resolve the target user: doctors can view any patient's feed; patients
  // can only view their own.
  const targetUserId =
    userIdParam && (isDoctor || userIdParam === payload.sub)
      ? userIdParam
      : payload.sub

  const notifications = await db.notification.findMany({
    where: { userId: targetUserId },
    orderBy: [{ read: 'asc' }, { createdAt: 'desc' }],
    take: limit,
  })

  const unreadCount = await db.notification.count({
    where: { userId: targetUserId, read: false },
  })

  return NextResponse.json({
    ok: true,
    notifications,
    unreadCount,
  })
}

/**
 * POST /api/v2/notifications/mark-all-read — mark all of the user's
 * notifications as read.
 */
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const result = await db.notification.updateMany({
    where: { userId: payload.sub, read: false },
    data: { read: true },
  })
  return NextResponse.json({ ok: true, updated: result.count })
}
