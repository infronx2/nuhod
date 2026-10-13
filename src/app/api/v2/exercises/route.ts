import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/v2/exercises — list the clinical exercise preset library.
// Public read; seeded lazily on first call.
export async function GET() {
  await ensureSeedPresets()
  const presets = await db.exercisePreset.findMany({
    where: { active: true },
    orderBy: [{ difficulty: 'asc' }, { name: 'asc' }],
  })
  return NextResponse.json({ ok: true, count: presets.length, presets })
}

const SEED_PRESETS = [
  { slug: 'elbow_flex_60', name: 'Gentle Elbow Flexion', nameAr: 'ثني الكوع الخفيف', description: 'Slow elbow flexion to 60° — early-stage ROM recovery', joint: 'elbow', limb: 'right', targetAngle: 60, difficulty: 'beginner', sessionsPerWeek: 5 },
  { slug: 'elbow_flex_90', name: 'Standard Elbow Flexion', nameAr: 'ثني الكوع القياسي', description: 'Functional elbow flexion to 90° — reach and lift', joint: 'elbow', limb: 'right', targetAngle: 90, difficulty: 'beginner', sessionsPerWeek: 5 },
  { slug: 'elbow_flex_120', name: 'Deep Elbow Flexion', nameAr: 'ثني الكوع العميق', description: 'Full elbow flexion to 120° — hand-to-mouth', joint: 'elbow', limb: 'right', targetAngle: 120, difficulty: 'intermediate', sessionsPerWeek: 4 },
  { slug: 'elbow_flex_150', name: 'Advanced Elbow Flexion', nameAr: 'ثني الكوع المتقدم', description: 'End-range flexion to 150° — fine motor recovery', joint: 'elbow', limb: 'right', targetAngle: 150, difficulty: 'advanced', sessionsPerWeek: 3 },
  { slug: 'shoulder_flex_90', name: 'Shoulder Forward Flexion', nameAr: 'ثني الكتف الأمامي', description: 'Raise arm forward to 90° — overhead reach prep', joint: 'shoulder', limb: 'right', targetAngle: 90, difficulty: 'intermediate', sessionsPerWeek: 4 },
  { slug: 'wrist_ext_45', name: 'Wrist Extension', nameAr: 'بسط المعصم', description: 'Wrist extension to 45° — grip strengthening', joint: 'wrist', limb: 'right', targetAngle: 45, difficulty: 'beginner', sessionsPerWeek: 6 },
  { slug: 'elbow_flex_90_left', name: 'Left Elbow Flexion', nameAr: 'ثني الكوع الأيسر', description: 'Mirror exercise for left affected side', joint: 'elbow', limb: 'left', targetAngle: 90, difficulty: 'beginner', sessionsPerWeek: 5 },
]

async function ensureSeedPresets() {
  const count = await db.exercisePreset.count()
  if (count > 0) return
  await db.exercisePreset.createMany({ data: SEED_PRESETS })
}
