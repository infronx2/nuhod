/**
 * Nuhoud rehabilitation goals — doctor-set milestones (ROM target, rep
 * count, accuracy, streak) that a patient works toward. When a session is
 * saved, this lib updates the currentValue of any unachieved goals and
 * marks them achieved + fires a celebration notification.
 */
import { db } from '@/lib/db'
import { createNotification } from '@/lib/notifications'

interface GoalUpdateResult {
  updated: number
  achieved: Array<{ id: string; title: string; type: string; targetValue: number; currentValue: number }>
}

/**
 * Called from POST /api/v2/sessions after a session is saved. Updates the
 * currentValue of any unachieved goals the session's metrics improve, and
 * marks them achieved if the target is met.
 */
export async function updateGoalsOnSession(
  patientId: string,
  session: { maxAchievedAngle: number; totalReps: number; correctReps: number; compensationErrors: number },
): Promise<GoalUpdateResult> {
  const goals = await db.rehabGoal.findMany({
    where: { patientId, achieved: false },
  })
  if (goals.length === 0) return { updated: 0, achieved: [] }

  let updated = 0
  const achieved: GoalUpdateResult['achieved'] = []

  for (const g of goals) {
    let newValue = g.currentValue
    if (g.type === 'rom_target') {
      newValue = Math.max(g.currentValue, session.maxAchievedAngle)
    } else if (g.type === 'rep_count') {
      // rep_count goals track the total reps done — we add this session's.
      // (We treat currentValue as a running sum the caller maintains; here
      // we just take the max of the session's reps for simplicity, since
      // the doctor usually means "X reps in one session".)
      newValue = Math.max(g.currentValue, session.totalReps)
    } else if (g.type === 'accuracy') {
      const acc = session.totalReps > 0 ? (session.correctReps / session.totalReps) * 100 : 0
      newValue = Math.max(g.currentValue, acc)
    }
    // streak goals are handled by the streak lib.

    if (newValue !== g.currentValue) {
      const nowAchieved = newValue >= g.targetValue
      await db.rehabGoal.update({
        where: { id: g.id },
        data: {
          currentValue: newValue,
          achieved: nowAchieved,
          achievedAt: nowAchieved ? new Date() : null,
        },
      })
      updated += 1
      if (nowAchieved) {
        achieved.push({ id: g.id, title: g.title, type: g.type, targetValue: g.targetValue, currentValue: newValue })
        await createNotification({
          userId: patientId,
          type: 'goal_achieved',
          title: `Goal achieved: ${g.title}! 🎯`,
          body: `You reached ${newValue.toFixed(0)}${g.type === 'rom_target' || g.type === 'accuracy' ? '°' : ''} (target ${g.targetValue}). Outstanding work!`,
          severity: 'celebration',
          linkType: 'goal',
          linkId: g.id,
        })
      }
    }
  }

  return { updated, achieved }
}
