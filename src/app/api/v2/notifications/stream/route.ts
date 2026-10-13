import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'

// SSE requires streaming — disable Next.js's static optimization.
export const dynamic = 'force-dynamic'

/**
 * GET /api/v2/notifications/stream
 *
 * Server-Sent Events stream for real-time notification delivery. Replaces
 * the 30s polling loop on the bell component with a persistent connection
 * that pushes new notifications the moment they're created.
 *
 * Protocol:
 *   - First message: `hello` event with the current unread count (so the
 *     bell hydrates immediately on connect).
 *   - Then a `notification` event for each NEW notification (polled from
 *     the DB every 5s — the cheapest "push" that works without a real
 *     message bus in the sandbox).
 *   - A `ping` comment every 15s to keep the connection alive through
 *     proxies.
 *
 * The client uses the EventSource API:
 *   const es = new EventSource('/api/v2/notifications/stream')
 *   es.addEventListener('notification', (e) => { ... })
 *   es.addEventListener('hello', (e) => { ... })
 */
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return new Response('unauthenticated', { status: 401 })
  }
  const userId = payload.sub

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      // Helper to send an SSE-formatted message.
      const send = (event: string, data: unknown) => {
        const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        try {
          controller.enqueue(encoder.encode(msg))
        } catch {
          // controller already closed (client disconnected)
        }
      }

      // 1. Hello — current unread count so the bell hydrates immediately.
      try {
        const unreadCount = await db.notification.count({
          where: { userId, read: false },
        })
        send('hello', { unreadCount, ts: Date.now() })
      } catch {
        /* db error — non-fatal */
      }

      // 2. Track the latest notification id we've seen so we only push new ones.
      let lastNotifId: string | null = null
      try {
        const latest = await db.notification.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })
        lastNotifId = latest?.id ?? null
      } catch {
        /* non-fatal */
      }

      // 3. Polling loop — check every 5s for new notifications.
      const POLL_MS = 5000
      const interval = setInterval(async () => {
        try {
          const newOnes = await db.notification.findMany({
            where: {
              userId,
              ...(lastNotifId ? { id: { gt: lastNotifId } } : {}),
            },
            orderBy: { createdAt: 'asc' },
            take: 10,
          })
          if (newOnes.length > 0) {
            lastNotifId = newOnes[newOnes.length - 1].id
            for (const n of newOnes) {
              send('notification', {
                id: n.id,
                type: n.type,
                title: n.title,
                body: n.body,
                severity: n.severity,
                read: n.read,
                createdAt: n.createdAt.toISOString(),
              })
            }
          }
          // Heartbeat ping to keep the connection alive.
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`))
          } catch {
            clearInterval(interval)
          }
        } catch {
          /* db error — keep the loop alive */
        }
      }, POLL_MS)

      // The Request signal isn't directly available on ReadableStream start,
      // so we rely on the controller.close() throwing on the next enqueue
      // when the client disconnects. The interval is cleared there.
      // Store a cleanup that the runtime can call.
      ;(controller as any)._nmCleanup = () => clearInterval(interval)
    },
    cancel() {
      // Client disconnected — cleanup happens via the interval's own try/catch.
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable Next.js buffering so chunks flush immediately.
      'X-Accel-Buffering': 'no',
    },
  })
}
