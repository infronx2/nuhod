import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'

/**
 * GET /api/v2/chat-history?patientId=X&limit=20
 *
 * Returns the persisted chat conversation between the current user and the
 * given patient (or themselves if no patientId). Newest-first ordering is
 * reversed client-side so the UI can append chronologically.
 */
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const url = new URL(req.url)
  const isDoctor = payload.role.toUpperCase() === 'DOCTOR' || payload.role.toUpperCase() === 'ADMIN'
  const patientId = url.searchParams.get('patientId')
  const targetPatient = patientId
    ? isDoctor
      ? String(patientId)
      : payload.sub === String(patientId)
        ? String(patientId)
        : payload.sub
    : payload.sub
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '40', 10) || 40, 200)

  const messages = await db.chatMessage.findMany({
    where: { speakerId: payload.sub, patientId: targetPatient },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  // Reverse so the oldest is first — the UI appends in chronological order.
  return NextResponse.json({
    ok: true,
    messages: messages.reverse().map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  })
}

/**
 * DELETE /api/v2/chat-history?patientId=X — clear the persisted conversation.
 */
export async function DELETE(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const url = new URL(req.url)
  const isDoctor = payload.role.toUpperCase() === 'DOCTOR' || payload.role.toUpperCase() === 'ADMIN'
  const patientId = url.searchParams.get('patientId')
  const targetPatient = patientId
    ? isDoctor
      ? String(patientId)
      : payload.sub === String(patientId)
        ? String(patientId)
        : payload.sub
    : payload.sub

  const result = await db.chatMessage.deleteMany({
    where: { speakerId: payload.sub, patientId: targetPatient },
  })
  return NextResponse.json({ ok: true, deleted: result.count })
}
