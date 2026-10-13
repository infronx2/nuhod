import { db } from '@/lib/db'

/**
 * Nuhoud gamification — checks a patient's full history and awards any
 * newly-earned badges. Idempotent: returns only badges that were actually
 * inserted in this call (the EarnedBadge table has a unique(userId, slug)).
 *
 * Badge catalog (Phase 2 starter set):
 *  - first_session   — completed the very first rehab session
 *  - ten_reps        — accumulated >= 10 total reps across all sessions
 *  - hundred_reps    — accumulated >= 100 total reps across all sessions
 *  - perfect_form    — completed a session with zero compensation errors
 *  - streak_3        — completed sessions on 3 distinct calendar days
 *  - sharpshooter    — reached >= 150° elbow flexion in any session
 */
export interface BadgeDef {
  slug: string
  name: string
  nameAr: string
  description: string
  icon: string // lucide icon name; the frontend maps slug→icon for safety
  tier: 'bronze' | 'silver' | 'gold'
}

export const BADGE_CATALOG: BadgeDef[] = [
  { slug: 'first_session', name: 'First Step', nameAr: 'الخطوة الأولى', description: 'Completed your first rehab session', icon: 'Footprints', tier: 'bronze' },
  { slug: 'ten_reps', name: 'Ten Strong', nameAr: 'عشر تكرارات', description: 'Accumulated 10 total reps', icon: 'Dumbbell', tier: 'bronze' },
  { slug: 'hundred_reps', name: 'Century Club', nameAr: 'مئة تكرار', description: 'Accumulated 100 total reps', icon: 'Medal', tier: 'silver' },
  { slug: 'perfect_form', name: 'Perfect Form', nameAr: 'تطابق مثالي', description: 'Completed a session with zero compensation errors', icon: 'Award', tier: 'silver' },
  { slug: 'streak_3', name: '3-Day Streak', nameAr: 'ثلاثة أيام متتالية', description: 'Trained on 3 distinct days', icon: 'Flame', tier: 'silver' },
  { slug: 'sharpshooter', name: 'Sharpshooter', nameAr: 'زواية حادة', description: 'Reached 150° elbow flexion', icon: 'Target', tier: 'gold' },
]

export function badgeBySlug(slug: string): BadgeDef | undefined {
  return BADGE_CATALOG.find((b) => b.slug === slug)
}

export async function awardBadges(userId: string): Promise<BadgeDef[]> {
  const sessions = await db.rehabSession.findMany({
    where: { patientId: userId },
    orderBy: { sessionDate: 'asc' },
  })
  if (sessions.length === 0) return []

  const earned = new Set<string>()
  const totalReps = sessions.reduce((s, x) => s + x.totalReps, 0)
  const maxAngle = sessions.reduce((m, x) => Math.max(m, x.maxAchievedAngle), 0)
  const perfectForm = sessions.some((s) => s.compensationErrors === 0 && s.totalReps > 0)
  const distinctDays = new Set(
    sessions.map((s) => new Date(s.sessionDate).toISOString().slice(0, 10)),
  )

  if (sessions.length >= 1) earned.add('first_session')
  if (totalReps >= 10) earned.add('ten_reps')
  if (totalReps >= 100) earned.add('hundred_reps')
  if (perfectForm) earned.add('perfect_form')
  if (distinctDays.size >= 3) earned.add('streak_3')
  if (maxAngle >= 150) earned.add('sharpshooter')

  const newBadges: BadgeDef[] = []
  for (const slug of earned) {
    try {
      await db.earnedBadge.create({ data: { userId, slug } })
      const def = badgeBySlug(slug)
      if (def) newBadges.push(def)
    } catch {
      // unique constraint → already earned; skip.
    }
  }
  return newBadges
}
