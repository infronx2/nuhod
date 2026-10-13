import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Quiet logs — 'query' floods the dev.log and contributes to dev-server
    // OOMs in this sandbox. Keep only warnings + errors.
    log: ['warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db