import { NextRequest, NextResponse } from 'next/server'
import { getStreak } from '@/lib/streaks'
import { getUserFromRequest } from '@/lib/auth'
import { canAccessPatient, isStaff, staffPatientIds, staffPatientWhere } from '@/lib/access'

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
  const userIdParam = url.searchParams.get('userId')
  const targetUserId =
    userIdParam && (await canAccessPatient(payload, userIdParam))
      ? userIdParam
      : payload.sub

  const streak = await getStreak(targetUserId)
  return NextResponse.json({ ok: true, streak })
}
