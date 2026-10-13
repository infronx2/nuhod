/**
 * Nuhoud notifications helper.
 *
 * Centralized create + fetch for the Notification feed. Called from:
 *  - badge awarding (after a session is saved)
 *  - plan prescription (doctor creates a plan)
 *  - session save (a milestone or streak)
 *  - any other event worth surfacing in the header bell dropdown.
 */
import { db } from '@/lib/db'
import { badgeBySlug } from '@/lib/badges'

export type NotificationType =
  | 'badge_earned'
  | 'plan_prescribed'
  | 'streak_milestone'
  | 'session_saved'
  | 'coach_summary'
  | 'goal_achieved'
  | 'info'

export type NotificationSeverity = 'success' | 'info' | 'warning' | 'celebration'

export interface CreateNotificationInput {
  userId: string
  type: NotificationType
  title: string
  body?: string
  severity?: NotificationSeverity
  linkType?: string
  linkId?: string
}

/**
 * Create a notification. Silent on failure so callers never crash because
 * of a notification error — the feed is best-effort.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  try {
    await db.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        severity: input.severity ?? 'info',
        linkType: input.linkType ?? null,
        linkId: input.linkId ?? null,
      },
    })
  } catch (err) {
    console.warn('[notifications] create failed', err)
  }
}

/**
 * Emit badge-earned notifications for a list of newly-awarded badge slugs.
 */
export async function notifyBadgesEarned(userId: string, slugs: string[]): Promise<void> {
  for (const slug of slugs) {
    const def = badgeBySlug(slug)
    if (!def) continue
    await createNotification({
      userId,
      type: 'badge_earned',
      title: `Badge earned: ${def.name}`,
      body: def.description,
      severity: def.tier === 'gold' ? 'celebration' : 'success',
      linkType: 'badge',
      linkId: slug,
    })
  }
}

/**
 * Emit a plan-prescribed notification to the patient.
 */
export async function notifyPlanPrescribed(
  patientId: string,
  planTitle: string,
  targetAngle: number,
): Promise<void> {
  await createNotification({
    userId: patientId,
    type: 'plan_prescribed',
    title: 'New treatment plan prescribed',
    body: `"${planTitle}" — target ${targetAngle}°. Check your dashboard for details.`,
    severity: 'info',
    linkType: 'plan',
  })
}
