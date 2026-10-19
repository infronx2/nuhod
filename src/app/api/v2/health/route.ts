import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/v2/health: a daily cron touches the database so the free Supabase project is never
// paused for inactivity (it pauses after a week without use, and the site and games stop).
export async function GET() {
  try {
    await db.$queryRawUnsafe('select 1')
    return NextResponse.json({ ok: true, db: 'up' })
  } catch {
    return NextResponse.json({ ok: false, db: 'down' }, { status: 503 })
  }
}
