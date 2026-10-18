/**
 * Mu'in (مُعين), Nuhoud's assistant, built to spend as few DeepSeek tokens as possible:
 * - one model call per message: the data the answer needs is fetched first and put in the prompt
 *   (compact JSON), instead of a tool round trip that resends the whole prompt;
 * - the fixed instructions come first and the data last, so DeepSeek's context cache serves the
 *   prefix (cache hits cost about 2% of a miss);
 * - the only tool is the doctor's plan proposal, and its call ends the turn without a second call;
 * - emergencies get fixed replies without the model, and every failure falls back to a reply
 *   built from the data.
 * The route adds the rest: short history, an answer cache, and a daily limit per user.
 */
import { complete, type LlmMessage } from './deepseek'
import { classify, fixedReply } from './safety'
import {
  getPlan, getProgress, getRecentSessions, listPatients, patientProfile, runTool, toolsFor,
  type MuinMode, type PlanProposal, type ToolContext,
} from './tools'

export interface MuinResult {
  reply: string
  toolsUsed: string[]
  proposal: PlanProposal | null
  /** deepseek: a model reply; fallback: built from the data without a model; safety: a fixed reply. */
  source: 'deepseek' | 'fallback' | 'safety'
}

export function isArabicText(text: string) {
  return /[؀-ۿ]/.test(text)
}

export async function runMuin(input: {
  mode: MuinMode
  patientId: string | null
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  message: string
  /** Reply in Arabic when the message has no clear language (e.g. numbers only). */
  preferArabic: boolean
  /** False when the user is over the daily model limit: answer from the data only. */
  allowModel?: boolean
}): Promise<MuinResult> {
  const { mode, patientId, message } = input
  const arabic = isArabicText(message) || (input.preferArabic && !/[a-z]{3,}/i.test(message))

  const flag = mode === 'patient' ? classify(message) : null
  if (flag === 'emergency' || flag === 'self_harm') {
    return { reply: fixedReply(flag, arabic), toolsUsed: [], proposal: null, source: 'safety' }
  }
  const fallback = async (): Promise<MuinResult> => ({
    reply: await fallbackReply(mode, patientId, arabic, flag === 'pain'),
    toolsUsed: [],
    proposal: null,
    source: 'fallback',
  })
  if (input.allowModel === false) return fallback()

  const ctx: ToolContext = { mode, patientId, codes: new Map(), proposal: null }
  const data = await contextData(ctx)
  const messages: LlmMessage[] = [
    { role: 'system', content: INSTRUCTIONS[mode] },
    { role: 'system', content: `${arabic ? LANG_AR : LANG_EN}${flag === 'pain' ? `\n${PAIN_NOTE}` : ''}\nDATA: ${JSON.stringify(data)}` },
    ...input.history.map((m) => ({ role: m.role, content: m.content }) as LlmMessage),
    { role: 'user', content: message },
  ]
  const tools = toolsFor(mode)
  const res = await complete(messages, { tools: tools.length ? tools : undefined })
  if (!res) return fallback()

  // A plan proposal ends the turn: the card shows the numbers, the reason is the reply.
  const call = res.tool_calls?.find((c) => c.function.name === 'propose_plan_change')
  if (call) {
    const out = (await runTool(call.function.name, call.function.arguments, ctx)) as { error?: string }
    const reason = ctx.proposal?.reason
    const text = res.content?.trim() || reason || (out.error ?? '')
    if (!text) return fallback()
    return { reply: text, toolsUsed: ['propose_plan_change'], proposal: ctx.proposal, source: 'deepseek' }
  }
  const text = (res.content ?? '').trim()
  if (!text) return fallback()
  return { reply: unmask(text, ctx), toolsUsed: [], proposal: null, source: 'deepseek' }
}

/** Everything the reply may need, in one compact object. */
async function contextData(ctx: ToolContext) {
  if (ctx.mode === 'doctor_roster') {
    return { patients: await listPatients(ctx) }
  }
  const id = ctx.patientId!
  const [profile, progress, sessions] = await Promise.all([patientProfile(id), getProgress(id), getRecentSessions(id, 3)])
  return {
    profile: profile && { ageBand: profile.ageBand, affectedSide: profile.affectedSide },
    plan: profile?.plan ?? null,
    progress,
    recentSessions: sessions,
  }
}

/** Roster codes back to names, after the model is done (the model never saw the names). */
function unmask(text: string, ctx: ToolContext) {
  if (!ctx.codes.size) return text
  return text.replace(/\bP(\d{1,3})\b/g, (m) => ctx.codes.get(m)?.name ?? m)
}

// The fixed part of every prompt. Keep these strings stable: an identical prefix is what DeepSeek's
// context cache bills at the cache-hit price.
const COMMON = `You are Mu'in (مُعين), the assistant of Nuhoud, an upper-limb stroke rehabilitation program in Oman. Patients train with a seated first-person game in an Omani majlis, tracked by a camera: hang a lantern (reach, fist grasp, raise to a hook: shoulder elevation and grip), serve a date (thumb-index pinch, carry to a plate: fine pinch and reach), eat a date (pinch to the mouth: elbow flexion). Tasks a hand cannot close on can be finished by touch and count as assisted. Doctors follow patients on a dashboard.
Rules:
- Use only numbers from DATA. Never invent or estimate numbers, dates or trends. If DATA lacks something, say so.
- Do not diagnose, prescribe, or discuss medication. You never change the plan yourself.
- Reply in 1 to 4 short sentences, no headings, no lists, no tables.
- Outside rehabilitation, say briefly you can only help with the rehab program.`

const INSTRUCTIONS: Record<MuinMode, string> = {
  patient: `${COMMON}
You are talking to the patient. Encourage with real progress from DATA, explain what a number means in daily life, and give one small next step. Tired is fine: suggest a short session or rest. Never push past pain.`,
  doctor_patient: `${COMMON}
You are talking to the treating doctor about one patient: be clinically precise (max angle against target, grip, pinch, adherence, assisted tasks, compensation, pain stops). If the doctor asks for a plan change, or DATA clearly supports one (target met in 3 recent sessions, or many assisted tasks or pain stops), call propose_plan_change with small steps (angle 5-10°, daily goal 2-5) and a one-sentence reason citing DATA, in the conversation's language; the doctor approves it on a card.`,
  doctor_roster: `${COMMON}
You are talking to the treating doctor about all patients. DATA lists them as codes (P1, P2...): refer to them only by code. Prioritise pain stops, 3+ days without a session, an angle trend of -5° or worse, an assisted share of 0.5+, sessions this week below the plan.`,
}

const LANG_AR = 'Reply in Arabic, in a warm, simple Omani/Gulf dialect (e.g. "زين", "شوي", "ما عليك"). Use the degree sign for angles.'
const LANG_EN = 'Reply in English, plainly.'
const PAIN_NOTE = 'The patient mentioned pain: first tell them to stop and rest, that pain is not part of training, and to tell their doctor if it continues or is strong. No advice about the pain itself.'

// ---------------------------------------------------------------------------------------------
// Fallbacks: built only from the data, when DeepSeek is not configured, fails, or the daily
// limit is reached.

async function fallbackReply(mode: MuinMode, patientId: string | null, arabic: boolean, pain: boolean): Promise<string> {
  if (mode === 'doctor_roster' || !patientId) {
    return arabic
      ? 'مُعين غير متصل حالياً. قائمة المرضى ومؤشراتهم (يحتاج متابعة، يتحسن، مستقر) ظاهرة في اللوحة.'
      : "Mu'in is offline right now. The roster's status indicators (attention, improving, stable) are on the dashboard."
  }
  const [p, plan, last] = await Promise.all([getProgress(patientId), getPlan(patientId), getRecentSessions(patientId, 1)])
  const s = last[0]
  const painLine = arabic
    ? 'إذا حسيت بألم وقّف التمرين وارتاح، وإذا استمر الألم أو كان قوي كلّم دكتورك.'
    : 'If it hurts, stop and rest; tell your doctor if the pain continues or is strong.'
  if (mode === 'doctor_patient') {
    return arabic
      ? `مُعين غير متصل حالياً، هذي الأرقام: ${p.allTimeSessions} جلسة، أفضل زاوية ${p.allTimeBestAngleDeg}°${plan ? ` (الهدف ${plan.targetAngleDeg}°)` : ''}، أفضل قبضة ${p.allTimeBestGripPct}%.${s ? ` آخر جلسة ${s.date.slice(0, 10)}: ${s.tasks} مهام، زاوية ${s.maxAngleDeg}°، ${s.assistedTasks} بمساعدة${s.painStop ? '، وتوقفت بسبب ألم' : ''}.` : ''}`
      : `Mu'in is offline; the numbers: ${p.allTimeSessions} sessions, best angle ${p.allTimeBestAngleDeg}°${plan ? ` (target ${plan.targetAngleDeg}°)` : ''}, best grip ${p.allTimeBestGripPct}%.${s ? ` Last session ${s.date.slice(0, 10)}: ${s.tasks} tasks, ${s.maxAngleDeg}°, ${s.assistedTasks} assisted${s.painStop ? ', ended for pain' : ''}.` : ''}`
  }
  if (p.allTimeSessions === 0) {
    return (arabic
      ? 'مُعين غير متصل حالياً. ما عندك جلسات للحين، ابدأ أول جلسة من زر "ابدأ الجلسة" وبتشوف تقدمك هنا.'
      : "Mu'in is offline right now. You have no sessions yet; start your first one with the Start session button.") + (pain ? ` ${painLine}` : '')
  }
  const goal = p.today.dailyGoal
  const done = goal !== null && p.today.tasks >= goal
  const today = arabic
    ? done ? `وخلصت هدف اليوم (${p.today.tasks} مهمة).` : goal ? `اليوم خلصت ${p.today.tasks} من ${goal} مهمة.` : `اليوم خلصت ${p.today.tasks} مهمة.`
    : done ? `Today's goal is done (${p.today.tasks} tasks).` : goal ? `Today: ${p.today.tasks} of ${goal} tasks.` : `Today: ${p.today.tasks} tasks.`
  const body = arabic
    ? `مُعين غير متصل حالياً، بس هذي أرقامك: ${p.allTimeSessions} جلسة، أفضل زاوية ${p.allTimeBestAngleDeg}°${plan ? ` وهدفك ${plan.targetAngleDeg}°` : ''}، و${p.streakDays} يوم متتالي. ${today} كل حركة تفرق، استمر.`
    : `Mu'in is offline, but here are your numbers: ${p.allTimeSessions} sessions, best angle ${p.allTimeBestAngleDeg}°${plan ? ` (target ${plan.targetAngleDeg}°)` : ''}, ${p.streakDays}-day streak. ${today} Every movement counts.`
  return pain ? `${painLine} ${body}` : body
}
