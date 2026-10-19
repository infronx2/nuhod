import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Supabase's pooler in session mode (port 5432) gives each client its own database connection and
 * allows only pool_size (15) clients, so a burst of serverless functions, each with Prisma's default
 * pool of several connections, runs it out and requests fail with HTTP 500 ("max clients reached").
 * Transaction mode (port 6543) shares the connections between clients; Prisma then needs
 * pgbouncer=true (no prepared statements), and one connection per function instance is enough.
 * Any other database URL (local Postgres, `prisma dev`) is used as given.
 */
export function serverlessDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw
  try {
    const url = new URL(raw)
    if (!url.hostname.endsWith('.pooler.supabase.com')) return raw
    if (url.port === '5432' || url.port === '') url.port = '6543'
    if (!url.searchParams.has('pgbouncer')) url.searchParams.set('pgbouncer', 'true')
    if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '1')
    return url.toString()
  } catch {
    return raw
  }
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: serverlessDatabaseUrl(process.env.DATABASE_URL),
    // Query logging is too noisy, warnings and errors are enough.
    log: ['warn', 'error'],
  })

// One client per server instance (also keeps dev hot reloads from opening new pools).
globalForPrisma.prisma = db
