/**
 * Sign-in lockout: after too many wrong attempts on one account (a PIN has only a million values)
 * or from one network address, sign-in is refused for a while. Kept in the database because every
 * serverless instance must see the same count.
 */
import { db } from '@/lib/db'

const WINDOW_MS = 15 * 60 * 1000
const ACCOUNT_LIMIT = 5
const ADDRESS_LIMIT = 30

export function accountKey(identifier: string) { return `acct:${identifier.toLowerCase()}` }
export function addressKey(ip: string | null) { return `ip:${ip ?? 'unknown'}` }

/** Minutes until sign-in opens again for these keys, or 0 when it is open. */
export async function lockedMinutes(account: string | null, address: string): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MS)
  const [byAccount, byAddress] = await Promise.all([
    account ? db.authAttempt.findMany({ where: { key: account, createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }) : [],
    db.authAttempt.count({ where: { key: address, createdAt: { gte: since } } }),
  ])
  const oldestRelevant = byAccount.length >= ACCOUNT_LIMIT ? byAccount[byAccount.length - ACCOUNT_LIMIT].createdAt : null
  if (oldestRelevant) return Math.max(1, Math.ceil((oldestRelevant.getTime() + WINDOW_MS - Date.now()) / 60000))
  if (byAddress >= ADDRESS_LIMIT) return Math.ceil(WINDOW_MS / 60000)
  return 0
}

export async function recordFailure(keys: string[]): Promise<void> {
  await db.authAttempt.createMany({ data: keys.map((key) => ({ key })) })
  // Now and then, drop attempts older than a day so the table stays small.
  if (Math.random() < 0.05) {
    await db.authAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } } }).catch(() => undefined)
  }
}

export async function clearFailures(account: string): Promise<void> {
  await db.authAttempt.deleteMany({ where: { key: account } }).catch(() => undefined)
}
