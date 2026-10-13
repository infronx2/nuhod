import { NextRequest, NextResponse } from 'next/server'
import { getStreak } from '@/lib/streaks'
import { getUserFromRequest } from '@/lib/auth'

/**
 * GET /api/v2/streak?userId=X — returns the streak for the current user
 * (or, for doctors, any patient's streak via userId).
 */
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const url = new URL(req.url)
  const isDoctor = payload.role.toUpperCase() === 'DOCTOR' || payload.role.toUpperCase() === 'ADMIN'
  const userIdParam = url.searchParams.get('userId')
  const targetUserId =
    userIdParam && (isDoctor || userIdParam === payload.sub)
      ? userIdParam
      : payload.sub

  const streak = await getStreak(targetUserId)
  return NextResponse.json({ ok: true, streak })
}
