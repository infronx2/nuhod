/**
 * Checks that run on the patient's message before any model sees it. Emergencies get a fixed,
 * reviewed reply: a model must never be the thing deciding whether to call 9999.
 */

// Warning signs of a new stroke or another emergency (BE-FAST plus chest pain, breathing, fainting).
const EMERGENCY = [
  /ثقل\s*(في|ف)?\s*(ال)?(كلام|لسان|اللسان)/, /(كلامي|لساني)\s*(ثقيل|ثقل|متلخبط|مو\s*واضح)/, /ما\s*(اقدر|أقدر|قادر)\s*(اتكلم|أتكلم)/,
  /(وجهي|فمي|الوجه)\s*(مايل|معوج|طايح|نازل)/, /ميلان\s*(في|ف)?\s*(ال)?وجه/,
  /(ضعف|خدر|تنميل)\s*(مفاجئ|فجأة|جديد)/, /فجأة\s*(ما|ضعف|خدر|تنميل)/, /(ما\s*(اقدر|أقدر)\s*(احرك|أحرك)).*(فجأة|الحين|اليوم)/,
  /ألم\s*(في|ف)?\s*(ال)?صدر/, /الم\s*(في|ف)?\s*(ال)?صدر/, /(صدري|قلبي)\s*(يوجع|يعور|يألم|ضايق)/,
  /(ضيق|صعوبة)\s*(في|ف)?\s*(ال)?(تنفس|نفس)/, /ما\s*(اقدر|أقدر)\s*(اتنفس|أتنفس)/,
  /(اغمى|أغمى|إغماء|اغماء|غبت\s*عن\s*الوعي)/,
  /صداع\s*(قوي|شديد|مفاجئ)/, /(ما\s*(اشوف|أشوف)|عيني\s*ما\s*تشوف|زغللة\s*مفاجئة|رؤية\s*مزدوجة)/,
  /(slurred|can'?t\s+speak|face\s+droop|sudden\s+(weakness|numbness)|chest\s+pain|can'?t\s+breathe|fainted|passed\s+out|worst\s+headache)/i,
]

// Thoughts of self-harm.
const SELF_HARM = [/(انتحر|انتحار|اقتل\s*نفسي|أقتل\s*نفسي|ابي\s*اموت|أبي\s*أموت|ما\s*ابي\s*اعيش|ما\s*أبي\s*أعيش)/, /(suicide|kill\s+myself|want\s+to\s+die)/i]

// Pain during or after exercise: not an emergency, but the model must tell them to stop.
const PAIN = [/(ألم|الم|يعورني|يعور|يوجعني|يوجع|توجعني|وجع)/, /\b(pain|hurts?|sore)\b/i]

export type SafetyFlag = 'emergency' | 'self_harm' | 'pain' | null

export function classify(message: string): SafetyFlag {
  if (EMERGENCY.some((r) => r.test(message))) return 'emergency'
  if (SELF_HARM.some((r) => r.test(message))) return 'self_harm'
  if (PAIN.some((r) => r.test(message))) return 'pain'
  return null
}

export function fixedReply(flag: 'emergency' | 'self_harm', arabic: boolean): string {
  if (flag === 'emergency') {
    return arabic
      ? 'هذي علامات ممكن تكون خطيرة. اتصل بالطوارئ ٩٩٩٩ الحين، أو خلّ أحد من أهلك يتصل. لا تنتظر ولا تكمل التمرين، ولا تسوق السيارة بنفسك. سجّل الوقت اللي بدأت فيه الأعراض، الأطباء بيسألون عنه.'
      : 'These can be warning signs of an emergency. Call 9999 now, or have someone with you call. Do not wait, stop the exercise, and do not drive yourself. Note the time the symptoms started; the doctors will ask.'
  }
  return arabic
    ? 'أنا معك، وكلامك يهمني. إذا تفكر تأذي نفسك، اتصل بالطوارئ ٩٩٩٩ الحين، أو كلّم أحد تثق فيه من أهلك يكون جنبك. وكلّم دكتورك بعد، تعب ما بعد الجلطة شي معروف وله علاج.'
    : "I'm with you, and what you said matters. If you are thinking of harming yourself, call 9999 now or ask someone you trust to stay with you. Please tell your doctor too; low mood after a stroke is common and treatable."
}
