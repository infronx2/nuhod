// Start the trial with a clean database: saves a full backup first, then deletes every patient and
// their data (sessions, plans, measures, goals, chats, notifications, sign-in records). Doctor and
// admin accounts and the exercise library stay.
//
//   node scripts/reset-trial-data.mjs            shows what would be deleted, changes nothing
//   node scripts/reset-trial-data.mjs --confirm  backs up to backup_<time>.json, then deletes
//
// Uses DATABASE_URL from .env. The backup holds patient data: keep it private (it is git-ignored).
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'

const url = process.env.DATABASE_URL || fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)?.[1]
const db = new PrismaClient({ datasourceUrl: url, log: [] })
const confirm = process.argv.includes('--confirm')

const tables = ['user', 'treatmentPlan', 'rehabSession', 'outcomeMeasure', 'rehabGoal', 'chatMessage', 'notification',
  'earnedBadge', 'streak', 'passkey', 'loginToken', 'authAttempt', 'auditLog', 'exercisePreset']

const patients = await db.user.findMany({ where: { role: 'PATIENT' }, select: { id: true } })
const ids = patients.map((p) => p.id)
const counts = {
  patients: ids.length,
  sessions: await db.rehabSession.count({ where: { patientId: { in: ids } } }),
  plans: await db.treatmentPlan.count({ where: { patientId: { in: ids } } }),
  measures: await db.outcomeMeasure.count({ where: { patientId: { in: ids } } }),
}
console.log('Will delete:', counts, '\nKeeps:', await db.user.count({ where: { role: { not: 'PATIENT' } } }), 'doctor/admin accounts')

if (!confirm) {
  console.log('\nNothing changed. Run again with --confirm to back up and delete.')
} else {
  const backup = {}
  for (const t of tables) backup[t] = await db[t].findMany()
  const file = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  fs.writeFileSync(file, JSON.stringify(backup, (_, v) => (v?.type === 'Buffer' ? Buffer.from(v.data).toString('base64') : v), 2))
  console.log(`Backup saved: ${file}`)

  await db.$transaction([
    db.rehabSession.deleteMany({ where: { patientId: { in: ids } } }),
    db.treatmentPlan.deleteMany({ where: { patientId: { in: ids } } }),
    db.rehabGoal.deleteMany({ where: { patientId: { in: ids } } }),
    db.chatMessage.deleteMany({ where: { OR: [{ patientId: { in: ids } }, { speakerId: { in: ids } }] } }),
    db.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { linkId: { in: ids } }] } }),
    db.streak.deleteMany({ where: { userId: { in: ids } } }),
    db.loginToken.deleteMany({}),
    db.authAttempt.deleteMany({}),
    db.auditLog.deleteMany({}),
    // Passkeys, measures and badges go with their patient (cascade).
    db.user.deleteMany({ where: { id: { in: ids } } }),
  ])
  console.log('Done: patient data deleted. Doctors can now add the trial patients.')
}
await db.$disconnect()
