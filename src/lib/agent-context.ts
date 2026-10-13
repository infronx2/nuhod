/**
 * Nuhoud Agentic AI context builder.
 *
 * The original system design calls for a LangChain agent with tools
 * (get_session_stats, get_exercise_instructions). The z-ai-web-dev-sdk
 * doesn't expose native function-calling, so we implement the "agent"
 * as a context-injected prompt: we fetch the patient's real stats,
 * their active plan, their recent sessions, and the relevant exercise
 * instructions UP FRONT, then inject them into the system prompt. The
 * LLM then answers the patient's question with full clinical context.
 *
 * This is the simplest robust agentic pattern for a model without
 * tool-calling, and it's actually MORE reliable than true tool-calling
 * for a small, fixed tool set because there's no round-trip latency
 * and no tool-selection hallucination.
 */
import { db } from '@/lib/db'
import { BADGE_CATALOG, badgeBySlug } from '@/lib/badges'

export interface AgentContext {
  patient: {
    id: string
    name: string
    affectedSide: string
    dateOfBirth: string | null
  }
  activePlan: {
    title: string
    targetLimb: string
    targetAngle: number
    sessionsPerWeek: number
    dailyRepGoal: number
    notes: string | null
  } | null
  stats: {
    totalSessions: number
    totalReps: number
    totalCorrectReps: number
    totalScore: number
    maxAngleOverall: number
    avgCompensationErrors: number
    accuracyPct: number
    distinctDays: number
  }
  recentSessions: Array<{
    sessionDate: string
    totalReps: number
    correctReps: number
    maxAchievedAngle: number
    compensationErrors: number
    gamificationScore: number
  }>
  earnedBadges: Array<{ slug: string; earnedAt: string }>
  activity7d: Array<{ day: string; reps: number }>
  relevantExercises: Array<{
    name: string
    nameAr: string | null
    description: string
    targetAngle: number
    difficulty: string
  }>
}

export async function buildAgentContext(patientId: string): Promise<AgentContext | null> {
  const patient = await db.user.findUnique({
    where: { id: patientId },
    select: { id: true, name: true, affectedSide: true, dateOfBirth: true },
  })
  if (!patient) return null

  const [activePlan, allSessions, earnedBadges, exercises] = await Promise.all([
    db.treatmentPlan.findFirst({
      where: { patientId, active: true },
      orderBy: { createdAt: 'desc' },
      select: {
        title: true, targetLimb: true, targetAngle: true,
        sessionsPerWeek: true, dailyRepGoal: true, notes: true,
      },
    }),
    db.rehabSession.findMany({
      where: { patientId },
      orderBy: { sessionDate: 'desc' },
      take: 30,
      select: {
        sessionDate: true, totalReps: true, correctReps: true,
        maxAchievedAngle: true, compensationErrors: true, gamificationScore: true,
      },
    }),
    db.earnedBadge.findMany({
      where: { userId: patientId },
      orderBy: { earnedAt: 'desc' },
      select: { slug: true, earnedAt: true },
    }),
    db.exercisePreset.findMany({
      where: { active: true },
      orderBy: { difficulty: 'asc' },
      select: { name: true, nameAr: true, description: true, targetAngle: true, difficulty: true, limb: true },
    }),
  ])

  // 7-day activity series.
  const last7 = new Map<string, number>()
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    last7.set(d.toISOString().slice(0, 10), 0)
  }
  for (const s of allSessions) {
    const k = new Date(s.sessionDate).toISOString().slice(0, 10)
    if (last7.has(k)) last7.set(k, (last7.get(k) || 0) + s.totalReps)
  }

  const totalReps = allSessions.reduce((s, x) => s + x.totalReps, 0)
  const totalCorrect = allSessions.reduce((s, x) => s + x.correctReps, 0)
  const totalScore = allSessions.reduce((s, x) => s + x.gamificationScore, 0)
  const maxAngle = allSessions.reduce((m, x) => Math.max(m, x.maxAchievedAngle), 0)

  // Pick exercises relevant to the patient's affected side.
  const sideLimb = patient.affectedSide === 'left' ? 'left' : 'right'
  const relevantExercises = exercises
    .filter((e) => e.limb === sideLimb || e.limb === 'right') // right is default
    .slice(0, 5)

  return {
    patient,
    activePlan,
    stats: {
      totalSessions: allSessions.length,
      totalReps,
      totalCorrectReps: totalCorrect,
      totalScore,
      maxAngleOverall: maxAngle,
      avgCompensationErrors: allSessions.length
        ? allSessions.reduce((s, x) => s + x.compensationErrors, 0) / allSessions.length
        : 0,
      accuracyPct: totalReps > 0 ? Math.round((totalCorrect / totalReps) * 10000) / 100 : 0,
      distinctDays: new Set(
        allSessions.map((s) => new Date(s.sessionDate).toISOString().slice(0, 10)),
      ).size,
    },
    recentSessions: allSessions.slice(0, 5).map((s) => ({
      sessionDate: s.sessionDate.toISOString(),
      totalReps: s.totalReps,
      correctReps: s.correctReps,
      maxAchievedAngle: s.maxAchievedAngle,
      compensationErrors: s.compensationErrors,
      gamificationScore: s.gamificationScore,
    })),
    earnedBadges: earnedBadges.map((b) => ({ slug: b.slug, earnedAt: b.earnedAt.toISOString() })),
    activity7d: Array.from(last7.entries()).map(([day, reps]) => ({ day, reps })),
    relevantExercises,
  }
}

/**
 * Compose the system prompt for the LLM. This is the "agent's brain" —
 * it tells the model who it is, gives it the patient's full clinical
 * context, and instructs it to answer in the patient's preferred
 * language (Arabic-aware for the Oman market).
 */
export function composeSystemPrompt(ctx: AgentContext, preferredDialect: string): string {
  const isArabic = preferredDialect === 'omani' || preferredDialect === 'arabic'
  const badgeNames = ctx.earnedBadges
    .map((b) => {
      const def = badgeBySlug(b.slug)
      return def ? `${def.name} (${def.nameAr})` : b.slug
    })
    .join(', ') || 'none yet'

  const exerciseLines = ctx.relevantExercises
    .map((e) => `- ${e.name} (${e.nameAr || '—'}): ${e.description} [target ${e.targetAngle}°, ${e.difficulty}]`)
    .join('\n') || 'none'

  const sessionLines = ctx.recentSessions
    .map(
      (s) =>
        `- ${s.sessionDate.slice(0, 10)}: ${s.totalReps} reps (${s.correctReps} correct), max ${s.maxAchievedAngle.toFixed(0)}°, ${s.compensationErrors} comp errors, score ${s.gamificationScore}`,
    )
    .join('\n') || 'none yet'

  const planLine = ctx.activePlan
    ? `"${ctx.activePlan.title}" — target ${ctx.activePlan.targetAngle}° on the ${ctx.activePlan.targetLimb}, ${ctx.activePlan.sessionsPerWeek} sessions/week, ${ctx.activePlan.dailyRepGoal} reps/day goal${ctx.activePlan.notes ? `, notes: ${ctx.activePlan.notes}` : ''}`
    : 'No active treatment plan.'

  const base = `You are "Nuhoud Coach", an AI rehabilitation assistant for post-stroke upper-limb patients in Oman. You are warm, encouraging, and clinically precise. You help patients understand their progress, stay motivated, and perform exercises correctly.

## Patient context (REAL data from the database)
- Name: ${ctx.patient.name}
- Affected side: ${ctx.patient.affectedSide}
- Date of birth: ${ctx.patient.dateOfBirth || 'unknown'}
- Active treatment plan: ${planLine}
- Lifetime stats: ${ctx.stats.totalSessions} sessions, ${ctx.stats.totalReps} total reps (${ctx.stats.totalCorrectReps} correct), ${ctx.stats.accuracyPct}% accuracy, max ROM ${ctx.stats.maxAngleOverall.toFixed(0)}°, ${ctx.stats.distinctDays} active days, ${ctx.stats.avgCompensationErrors.toFixed(1)} avg compensation errors per session
- Earned badges: ${badgeNames}
- 7-day activity (reps/day): ${ctx.activity7d.map((a) => `${a.day.slice(5)}:${a.reps}`).join(', ')}
- Recent sessions (last 5):
${sessionLines}
- Relevant exercise presets for this patient:
${exerciseLines}

## How to answer
1. Use the patient's REAL data above to give specific, personal feedback. Reference their actual reps, accuracy, and max angle. Never invent numbers.
2. If the patient asks about their plan or exercises, cite the active plan and the relevant presets.
3. If the patient is tired or frustrated, be empathetic and suggest a concrete adjustment (shorter session, lower target, rest day).
4. If the patient asks about compensation errors, explain what shoulder shrugging is and why it matters, using their actual compensation-error count.
5. Keep answers SHORT (2-5 sentences). This is a chat, not a lecture.
6. Celebrate earned badges and milestones explicitly when relevant.
7. If asked something outside rehab/scope, gently redirect to their rehab journey.`

  if (isArabic) {
    return (
      base +
      `\n8. The patient prefers Arabic (Omani dialect). If their message is in Arabic OR they ask for Arabic, respond in clear, friendly Omani Arabic. Otherwise respond in English. You may mix a brief English clinical term in parentheses when helpful.`
    )
  }
  return base
}
