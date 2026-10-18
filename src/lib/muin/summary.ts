/**
 * After-session summaries: when a session is stored, Mu'in writes two short notes, one to the
 * patient (encouragement and the result) and one to each doctor with an active plan for them
 * (numbers and a clinical remark). Each lands in that person's Mu'in conversation about the
 * patient, with a notification. The notes come from templates unless MUIN_AI_SUMMARIES=1. Runs after the response (see `after` in the sessions route), so a
 * slow or failing model never delays or breaks a session upload.
 */
import { db } from '@/lib/db'
import { createNotification } from '@/lib/notifications'
import { complete } from './deepseek'
import { sessionFacts } from './tools'

export async function summarizeSession(sessionId: string): Promise<void> {
  const session = await db.rehabSession.findUnique({ where: { id: sessionId } })
  if (!session) return
  const [patient, previous, plan, todayCount, doctorPlans] = await Promise.all([
    db.user.findUnique({ where: { id: session.patientId }, select: { name: true } }),
    db.rehabSession.findFirst({
      where: { patientId: session.patientId, sessionDate: { lt: session.sessionDate } },
      orderBy: { sessionDate: 'desc' },
    }),
    db.treatmentPlan.findFirst({ where: { patientId: session.patientId, active: true }, orderBy: { createdAt: 'desc' } }),
    db.rehabSession.aggregate({
      where: { patientId: session.patientId, sessionDate: { gte: startOfDay(session.sessionDate), lte: session.sessionDate } },
      _sum: { totalReps: true },
    }),
    db.treatmentPlan.findMany({ where: { patientId: session.patientId, active: true }, select: { doctorId: true } }),
  ])
  if (!patient) return

  const facts = {
    session: sessionFacts(session),
    previousSession: previous ? sessionFacts(previous) : null,
    plan: plan ? { targetAngleDeg: plan.targetAngle, dailyTaskGoal: plan.dailyRepGoal } : null,
    tasksToday: todayCount._sum.totalReps ?? session.totalReps,
  }
  // Templates by default (no tokens); MUIN_AI_SUMMARIES=1 lets the model write them.
  const notes = (process.env.MUIN_AI_SUMMARIES === '1' ? await modelNotes(facts) : null) ?? templateNotes(facts)

  const doctorIds = [...new Set(doctorPlans.map((p) => p.doctorId))]
  await db.chatMessage.createMany({
    data: [
      { speakerId: session.patientId, patientId: session.patientId, role: 'assistant', content: notes.patient },
      ...doctorIds.map((d) => ({ speakerId: d, patientId: session.patientId, role: 'assistant', content: notes.doctor })),
    ],
  })
  await createNotification({
    userId: session.patientId,
    type: 'coach_summary',
    title: 'مُعين: ملخص جلستك',
    body: notes.patient,
    severity: session.painStop ? 'warning' : 'success',
    linkType: 'session',
    linkId: session.id,
  })
  for (const doctorId of doctorIds) {
    await createNotification({
      userId: doctorId,
      type: 'coach_summary',
      title: `مُعين: جلسة ${patient.name}`,
      body: notes.doctor,
      severity: session.painStop ? 'warning' : 'info',
      linkType: 'session',
      linkId: session.id,
    })
  }
}

type Facts = {
  session: ReturnType<typeof sessionFacts>
  previousSession: ReturnType<typeof sessionFacts> | null
  plan: { targetAngleDeg: number; dailyTaskGoal: number } | null
  tasksToday: number
}

async function modelNotes(facts: Facts): Promise<{ patient: string; doctor: string } | null> {
  const res = await complete(
    [
      {
        role: 'system',
        content: `You are Mu'in (مُعين), the assistant of Nuhoud, an upper-limb stroke rehab game set in an Omani majlis. Write two short notes about the session in the data, in Arabic, using only numbers from the data.
- "patient": to the patient, warm simple Omani dialect, at most 2 sentences: one real achievement (compare with the previous session or the plan only if it is true) and one small encouragement. If painStop is true, say it was right to stop, to rest, and to tell the doctor if the pain continues; no praise about pushing.
- "doctor": to the treating doctor, clinical Modern Standard Arabic, at most 2 sentences: max angle against the target and the previous session, grip or pinch, assisted tasks, compensation, and a pain stop if any. No recommendations about medication.
Return only JSON: {"patient": "...", "doctor": "..."}`,
      },
      { role: 'user', content: JSON.stringify(facts) },
    ],
    { maxTokens: 350, temperature: 0.5 },
  )
  if (!res?.content) return null
  try {
    const json = JSON.parse(res.content.replace(/^```(json)?|```$/gm, '').trim())
    if (typeof json.patient === 'string' && typeof json.doctor === 'string' && json.patient && json.doctor) {
      return { patient: json.patient.slice(0, 600), doctor: json.doctor.slice(0, 600) }
    }
  } catch {
    /* fall through to the template */
  }
  return null
}

/** The same two notes from a template, when the model is not configured or did not answer. */
export function templateNotes(f: Facts): { patient: string; doctor: string } {
  const s = f.session
  const prev = f.previousSession
  const target = f.plan?.targetAngleDeg
  const goal = f.plan?.dailyTaskGoal
  let patient: string
  if (s.painStop) {
    patient = 'أحسنت إنك وقفت لما حسيت بألم، هذا الصح. ارتاح اليوم، وإذا الألم استمر كلّم دكتورك.'
  } else {
    const win =
      target && s.maxAngleDeg >= target
        ? `وصلت زاوية ${s.maxAngleDeg}° ووصلت هدفك ${target}°!`
        : prev && s.maxAngleDeg > prev.maxAngleDeg
          ? `رفعت يدك ${s.maxAngleDeg}°، أعلى من جلستك اللي قبل (${prev.maxAngleDeg}°).`
          : `خلصت ${s.tasks} مهام ووصلت زاوية ${s.maxAngleDeg}°.`
    const next = goal ? (f.tasksToday >= goal ? 'خلصت هدف اليوم، ما شاء الله.' : `باقي لك ${goal - f.tasksToday} مهام على هدف اليوم.`) : 'كل حركة تفرق، استمر.'
    patient = `زين! ${win} ${next}`
  }
  const parts = [
    `أقصى زاوية ${s.maxAngleDeg}°${target ? ` (الهدف ${target}°)` : ''}${prev ? `، السابقة ${prev.maxAngleDeg}°` : ''}`,
    `${s.tasks} مهام في ${s.minutes} دقيقة`,
    s.gripClosurePct ? `أقصى قبضة ${s.gripClosurePct}%` : null,
    s.assistedTasks ? `${s.assistedTasks} بمساعدة` : null,
    s.compensationErrors ? `${s.compensationErrors} أخطاء تعويض` : null,
  ].filter(Boolean)
  const doctor = `${parts.join('، ')}.${s.painStop ? ' أنهى المريض الجلسة بزر الألم.' : ''}`
  return { patient, doctor }
}

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
