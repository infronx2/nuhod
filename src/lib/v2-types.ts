/**
 * Phase 2 v2 API TypeScript contracts — mirror the Next.js API routes under
 * /api/v2. The Python pose-server still owns the WebSocket protocol; those
 * types live in `./components/nuhoud/types.ts`.
 */

export type UserRole = 'PATIENT' | 'DOCTOR' | 'ADMIN'

export interface V2User {
  id: string
  role: string
  email: string
  name: string
  avatarSeed: string
  preferredDialect?: string
  affectedSide?: string
  dateOfBirth?: string | null
  createdAt?: string
}

export interface AuthResponse {
  ok: true
  token: string
  user: V2User
}

export interface MeResponse {
  ok: true
  user: V2User
}

export interface V2Session {
  id: string
  patientId: string
  planId: string | null
  source: string
  limb: string
  sessionDate: string
  durationSeconds: number
  totalReps: number
  correctReps: number
  maxAchievedAngle: number
  compensationErrors: number
  gamificationScore: number
  angleTimeline?: string | null
  avgShoulderAngle?: number
  maxElbowROM?: number
  /** Majlis game hand function: best fist closure (0-100 %). */
  gripClosureMax?: number
  /** Closest thumb-index pinch in cm (0 = no pinch recorded). */
  pinchMinCm?: number
  graspCount?: number
  pinchCount?: number
  tasksAssisted?: number
  /** The patient ended the session with the pain-stop button. */
  painStop?: boolean
  clientSessionId?: string | null
  patient?: { name: string; email: string }
}

export interface V2SessionsResponse {
  ok: true
  count: number
  sessions: V2Session[]
}

export interface V2SaveSessionPayload {
  patientId: string
  planId?: string | null
  source?: string
  limb?: string
  durationSeconds: number
  totalReps: number
  correctReps: number
  maxAchievedAngle: number
  compensationErrors: number
  gamificationScore: number
  angleTimeline?: number[]
  avgShoulderAngle?: number
  maxElbowROM?: number
  gripClosureMax?: number
  pinchMinCm?: number
  graspCount?: number
  pinchCount?: number
  tasksAssisted?: number
  painStop?: boolean
  /** ISO time the session happened, for uploads queued offline. */
  sessionDate?: string
  /** Makes the upload idempotent: re-sending the same id returns the stored session. */
  clientSessionId?: string
}

export interface V2SaveSessionResponse {
  ok: true
  session: V2Session
  newBadges: { slug: string; name: string; nameAr: string; tier: string }[]
  /** True when clientSessionId matched a session that was already stored. */
  duplicate?: boolean
}

export interface V2Stats {
  ok: true
  count: number
  totalReps: number
  totalCorrectReps: number
  totalScore: number
  totalCompErrors: number
  totalDurationSeconds: number
  maxAngleOverall: number
  maxElbowROM?: number
  avgShoulderAngle?: number
  bestGripClosure?: number
  bestPinchCm?: number
  totalGrasps?: number
  totalPinches?: number
  totalAssisted?: number
  painStops?: number
  distinctDays: number
  accuracyPct: number
  activity7d: { day: string; reps: number }[]
}

export type V2PatientStatus = 'improving' | 'stable' | 'attention' | 'new'

/** Progress at a glance from the patient's last few sessions (see GET /api/v2/patients). */
export interface V2PatientIndicators {
  status: V2PatientStatus
  /** Degrees the newer sessions gained over the older ones; null with fewer than two sessions. */
  romTrend: number | null
  /** Compensation errors per rep (web tracker), 0..1. */
  compensationRate: number
  /** Majlis tasks finished only with assistance, per task, 0..1. */
  assistedRate: number
  painStops: number
  bestGrip: number | null
  recentSessions: number
}

export interface V2PatientPlanSummary {
  targetAngle: number
  dailyRepGoal: number
  sessionsPerWeek: number
  targetLimb: string
  notes?: string | null
}

export interface V2PatientSummary {
  id: string
  name: string
  email: string
  avatarSeed: string
  affectedSide: string
  dateOfBirth: string | null
  createdAt: string
  sessionsCount: number
  accuracy?: number
  plansCount: number
  latestSession: {
    sessionDate: string
    totalReps: number
    correctReps: number
    gamificationScore: number
    maxAchievedAngle: number
    compensationErrors: number
  } | null
  activePlan?: V2PatientPlanSummary | null
  indicators?: V2PatientIndicators
}

export interface V2PatientsResponse {
  ok: true
  isDoctor: boolean
  patients: V2PatientSummary[]
}

export interface V2TreatmentPlan {
  id: string
  patientId: string
  doctorId: string
  title: string
  targetLimb: string
  targetAngle: number
  sessionsPerWeek: number
  dailyRepGoal: number
  startDate: string
  endDate: string | null
  active: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
  doctor?: { id: string; name: string }
}

export interface V2EarnedBadge {
  id: string
  userId: string
  slug: string
  earnedAt: string
}

export interface V2PatientDetail {
  ok: true
  patient: V2User & { role: string }
  activePlan: V2TreatmentPlan | null
  sessions: V2Session[]
  earnedBadges: V2EarnedBadge[]
  aggregate: {
    totalSessions: number
    windowSessions: number
    totalReps: number
    totalCorrectReps: number
    totalScore: number
    maxAngleOverall: number
    avgCompensationErrors: number
    accuracyPct: number
  }
  isDoctor: boolean
}

export interface V2PlansResponse {
  ok: true
  plans: (V2TreatmentPlan & { doctor?: { id: string; name: string } })[]
}

export interface V2CreatePlanPayload {
  title?: string
  targetLimb?: string
  targetAngle?: number
  sessionsPerWeek?: number
  dailyRepGoal?: number
  notes?: string
}

export interface V2ExercisePreset {
  id: string
  slug: string
  name: string
  nameAr: string | null
  description: string
  joint: string
  limb: string
  targetAngle: number
  difficulty: string
  sessionsPerWeek: number
}

export interface V2ExercisesResponse {
  ok: true
  count: number
  presets: V2ExercisePreset[]
}

export interface V2FhirResponse {
  ok: true
  fhir: Record<string, unknown>
  session: {
    id: string
    patientId: string
    sessionDate: string
    limb: string
  }
}
