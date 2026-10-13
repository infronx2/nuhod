import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'

/**
 * POST /api/v2/seed
 *
 * Idempotently seeds the database with demo accounts + a couple of sample
 * sessions so the doctor dashboard isn't empty on first load.
 *
 * Demo accounts (password = "demo1234" for all):
 *   doctor@nuhoud.health   — DOCTOR
 *   layla@nuhoud.health    — PATIENT (right-side affected, lots of sessions)
 *   omar@nuhoud.health     — PATIENT (left-side affected, fewer sessions)
 */
export async function POST() {
  const created: Record<string, number> = {
    users: 0, plans: 0, sessions: 0, presets: 0, badges: 0,
  }

  const existingDoctor = await db.user.findUnique({ where: { email: 'doctor@nuhoud.health' } })
  if (!existingDoctor) {
    const doctor = await db.user.create({
      data: {
        email: 'doctor@nuhoud.health',
        name: 'د. سالم الحبسي',
        role: 'DOCTOR',
        passwordHash: hashPassword('demo1234'),
        avatarSeed: '14b8a6',
      },
    })

    const [layla, omar] = await Promise.all([
      db.user.create({
        data: {
          email: 'layla@nuhoud.health',
          name: 'ليلى المنذرية',
          role: 'PATIENT',
          passwordHash: hashPassword('demo1234'),
          avatarSeed: 'f43f5e',
          affectedSide: 'right',
          dateOfBirth: '1978-03-15',
        },
      }),
      db.user.create({
        data: {
          email: 'omar@nuhoud.health',
          name: 'عمر السناني',
          role: 'PATIENT',
          passwordHash: hashPassword('demo1234'),
          avatarSeed: 'f59e0b',
          affectedSide: 'left',
          dateOfBirth: '1969-11-22',
        },
      }),
    ])
    created.users = 3

    // Plans
    await db.treatmentPlan.create({
      data: {
        patientId: layla.id,
        doctorId: doctor.id,
        title: 'Right upper-limb recovery — week 1-4',
        targetLimb: 'upper_right',
        targetAngle: 90,
        sessionsPerWeek: 5,
        dailyRepGoal: 20,
      },
    })
    await db.treatmentPlan.create({
      data: {
        patientId: omar.id,
        doctorId: doctor.id,
        title: 'Left elbow ROM rebuild',
        targetLimb: 'upper_left',
        targetAngle: 100,
        sessionsPerWeek: 4,
        dailyRepGoal: 15,
      },
    })
    created.plans = 2

    // Sample sessions for Layla across the last 7 days
    const laylaSessions: Array<Partial<Record<string, number | string>>> = []
    const now = Date.now()
    const dayMs = 86400000
    for (let d = 6; d >= 0; d--) {
      const sessionsThatDay = d % 2 === 0 ? 2 : 1
      for (let s = 0; s < sessionsThatDay; s++) {
        const reps = 8 + Math.floor(Math.random() * 12)
        const correct = Math.max(0, reps - Math.floor(Math.random() * 4))
        const maxAng = 80 + Math.floor(Math.random() * 80)
        const compErrs = Math.floor(Math.random() * 5)
        laylaSessions.push({
          offsetMs: -d * dayMs - s * 6 * 3600000,
          reps, correct, maxAng, compErrs,
        })
      }
    }
    for (const ss of laylaSessions) {
      await db.rehabSession.create({
        data: {
          patientId: layla.id,
          source: 'demo',
          limb: 'right',
          sessionDate: new Date(now + (ss.offsetMs as number)),
          durationSeconds: 180 + Math.floor(Math.random() * 240),
          totalReps: ss.reps as number,
          correctReps: ss.correct as number,
          maxAchievedAngle: ss.maxAng as number,
          compensationErrors: ss.compErrs as number,
          gamificationScore: (ss.correct as number) * 10 + (ss.compErrs as number) * 3,
        },
      })
    }
    created.sessions += laylaSessions.length

    // Fewer sessions for Omar
    for (let d = 5; d >= 0; d -= 2) {
      const reps = 5 + Math.floor(Math.random() * 8)
      await db.rehabSession.create({
        data: {
          patientId: omar.id,
          source: 'demo',
          limb: 'left',
          sessionDate: new Date(now - d * dayMs),
          durationSeconds: 150 + Math.floor(Math.random() * 180),
          totalReps: reps,
          correctReps: Math.max(1, reps - Math.floor(Math.random() * 3)),
          maxAchievedAngle: 60 + Math.floor(Math.random() * 60),
          compensationErrors: Math.floor(Math.random() * 4),
          gamificationScore: reps * 8,
        },
      })
      created.sessions += 1
    }
  } else {
    created.users = 0
  }

  // Exercise presets (idempotent)
  const presetCount = await db.exercisePreset.count()
  if (presetCount === 0) {
    await db.exercisePreset.createMany({
      data: [
        { slug: 'elbow_flex_60', name: 'Gentle Elbow Flexion', nameAr: 'ثني الكوع الخفيف', description: 'Slow elbow flexion to 60° — early-stage ROM recovery', joint: 'elbow', limb: 'right', targetAngle: 60, difficulty: 'beginner', sessionsPerWeek: 5 },
        { slug: 'elbow_flex_90', name: 'Standard Elbow Flexion', nameAr: 'ثني الكوع القياسي', description: 'Functional elbow flexion to 90° — reach and lift', joint: 'elbow', limb: 'right', targetAngle: 90, difficulty: 'beginner', sessionsPerWeek: 5 },
        { slug: 'elbow_flex_120', name: 'Deep Elbow Flexion', nameAr: 'ثني الكوع العميق', description: 'Full elbow flexion to 120° — hand-to-mouth', joint: 'elbow', limb: 'right', targetAngle: 120, difficulty: 'intermediate', sessionsPerWeek: 4 },
        { slug: 'elbow_flex_150', name: 'Advanced Elbow Flexion', nameAr: 'ثني الكوع المتقدم', description: 'End-range flexion to 150° — fine motor recovery', joint: 'elbow', limb: 'right', targetAngle: 150, difficulty: 'advanced', sessionsPerWeek: 3 },
        { slug: 'shoulder_flex_90', name: 'Shoulder Forward Flexion', nameAr: 'ثني الكتف الأمامي', description: 'Raise arm forward to 90° — overhead reach prep', joint: 'shoulder', limb: 'right', targetAngle: 90, difficulty: 'intermediate', sessionsPerWeek: 4 },
        { slug: 'wrist_ext_45', name: 'Wrist Extension', nameAr: 'بسط المعصم', description: 'Wrist extension to 45° — grip strengthening', joint: 'wrist', limb: 'right', targetAngle: 45, difficulty: 'beginner', sessionsPerWeek: 6 },
        { slug: 'elbow_flex_90_left', name: 'Left Elbow Flexion', nameAr: 'ثني الكوع الأيسر', description: 'Mirror exercise for left affected side', joint: 'elbow', limb: 'left', targetAngle: 90, difficulty: 'beginner', sessionsPerWeek: 5 },
      ],
    })
    created.presets = 7
  }

  const userCount = await db.user.count()
  const sessionCount = await db.rehabSession.count()
  const presetCount2 = await db.exercisePreset.count()

  return NextResponse.json({
    ok: true,
    created,
    totals: { users: userCount, sessions: sessionCount, presets: presetCount2 },
    demoAccounts: [
      { email: 'doctor@nuhoud.health', password: 'demo1234', role: 'DOCTOR', name: 'د. سالم الحبسي' },
      { email: 'layla@nuhoud.health', password: 'demo1234', role: 'PATIENT', name: 'ليلى المنذرية' },
      { email: 'omar@nuhoud.health', password: 'demo1234', role: 'PATIENT', name: 'عمر السناني' },
    ],
  })
}
