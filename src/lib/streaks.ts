/**
 * Nuhoud streak tracker.
 *
 * Updates a patient's consecutive-day streak when a session is saved.
 * - A streak = days with at least one session, consecutive.
 * - A "freeze" (max 2) preserves a streak when the patient misses one day
 *   (Duolingo-style grace day).
 * - Milestone notifications fire at 3, 7, 14, 30, 60, 90 days.
 */
import { db } from '@/lib/db'
import { createNotification } from '@/lib/notifications'

const STREAK_MILESTONES = [3, 7, 14, 30, 60, 90]

export async function updateStreakOnSession(userId: string, sessionDate: Date): Promise<{
  current: number
  longest: number
  freezesLeft: number
  milestone: number | null
  usedFreeze: boolean
}> {
  const todayKey = sessionDate.toISOString().slice(0, 10)
  let streak = await db.streak.findUnique({ where: { userId } })
  if (!streak) {
    streak = await db.streak.create({ data: { userId, currentStreak: 1, longestStreak: 1, lastSessionDate: todayKey } })
    return { current: 1, longest: 1, freezesLeft: streak.freezesLeft, milestone: null, usedFreeze: false }
  }

  // Already trained today — no streak change.
  if (streak.lastSessionDate === todayKey) {
    return { current: streak.currentStreak, longest: streak.longestStreak, freezesLeft: streak.freezesLeft, milestone: null, usedFreeze: false }
  }

  // Compute the gap (in days) since the last session.
  const last = streak.lastSessionDate ? new Date(streak.lastSessionDate + 'T00:00:00Z') : null
  const today = new Date(todayKey + 'T00:00:00Z')
  const gapDays = last ? Math.round((today.getTime() - last.getTime()) / 86400000) : 1

  let newCurrent = streak.currentStreak
  let usedFreeze = false

  if (gapDays === 1) {
    // Consecutive day — increment.
    newCurrent = streak.currentStreak + 1
  } else if (gapDays === 2 && streak.freezesLeft > 0) {
    // Missed exactly one day — use a freeze to preserve the streak.
    newCurrent = streak.currentStreak + 1
    usedFreeze = true
  } else {
    // Gap too big or no freezes left — reset.
    newCurrent = 1
  }

  const newLongest = Math.max(streak.longestStreak, newCurrent)
  const newFreezes = usedFreeze ? Math.max(0, streak.freezesLeft - 1) : streak.freezesLeft
  // Recharge a freeze every 7 days of streak (max 2).
  const rechargedFreezes = newCurrent % 7 === 0 && newFreezes < 2 ? newFreezes + 1 : newFreezes

  await db.streak.update({
    where: { userId },
    data: {
      currentStreak: newCurrent,
      longestStreak: newLongest,
      freezesLeft: rechargedFreezes,
      lastSessionDate: todayKey,
    },
  })

  // Check for a milestone.
  let milestone: number | null = null
  if (STREAK_MILESTONES.includes(newCurrent)) {
    milestone = newCurrent
    await createNotification({
      userId,
      type: 'streak_milestone',
      title: `${newCurrent}-day streak! 🔥`,
      body: `You've trained ${newCurrent} days in a row. ${usedFreeze ? 'A streak freeze kept it alive — you have ' + rechargedFreezes + ' left.' : 'Keep it going!'}`,
      severity: 'celebration',
      linkType: 'streak',
    })
  }

  return { current: newCurrent, longest: newLongest, freezesLeft: rechargedFreezes, milestone, usedFreeze }
}

export async function getStreak(userId: string) {
  let streak = await db.streak.findUnique({ where: { userId } })
  if (!streak) {
    streak = await db.streak.create({ data: { userId } })
  }
  return {
    currentStreak: streak.currentStreak,
    longestStreak: streak.longestStreak,
    freezesLeft: streak.freezesLeft,
    lastSessionDate: streak.lastSessionDate,
  }
}
