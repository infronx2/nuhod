'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Smartphone, Brain, Database, Network } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Tier {
  id: number
  title: string
  subtitle: string
  detail: string
  icon: React.ComponentType<{ className?: string }>
  badge?: { label: string; tone: 'live' | 'phase' }
  accent: string
}

const TIERS: Tier[] = [
  {
    id: 1,
    title: 'Tier 1 · Client',
    subtitle: 'Unreal Engine 5',
    detail: 'Mobile app that captures camera frames at ~30 fps and renders the gamified rehab scene.',
    icon: Smartphone,
    accent: 'text-sky-400',
  },
  {
    id: 2,
    title: 'Tier 2 · Real-Time AI',
    subtitle: 'Python · FastAPI · WebSocket · MediaPipe Pose',
    detail: 'Inference tier — receives base64 JPEG frames, computes elbow angle + compensation, streams JSON verdicts. THIS is the live backend.',
    icon: Brain,
    badge: { label: 'LIVE', tone: 'live' },
    accent: 'text-emerald-400',
  },
  {
    id: 3,
    title: 'Tier 3 · Business / Data',
    subtitle: 'Supabase · PostgreSQL',
    detail: 'Session persistence, patient plans, gamification state, clinician dashboards.',
    icon: Database,
    badge: { label: 'Phase 2', tone: 'phase' },
    accent: 'text-amber-400',
  },
  {
    id: 4,
    title: 'Tier 4 · Integration',
    subtitle: 'HL7 FHIR · LangChain Agentic AI',
    detail: 'EHR interoperability via FHIR resources + an autonomous clinical-coaching agent.',
    icon: Network,
    badge: { label: 'Phase 3', tone: 'phase' },
    accent: 'text-rose-400',
  },
]

export function ArchitectureDiagram() {
  return (
    <motion.section
      aria-label="System architecture"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.45 }}
      className="rounded-xl border border-border/60 bg-card/40 p-4 sm:p-6"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            System Architecture
          </h2>
          <p className="text-sm text-muted-foreground">
            Four tiers — Tier 2 is live on :8001 right now.
          </p>
        </div>
        <Badge variant="outline" className="text-emerald-500">
          Phase 1 MVP
        </Badge>
      </div>

      <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
        {TIERS.map((tier, idx) => {
          const Icon = tier.icon
          return (
            <React.Fragment key={tier.id}>
              <motion.div
                whileHover={{ y: -2 }}
                className={cn(
                  'flex flex-1 flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm transition-colors',
                  tier.badge?.tone === 'live'
                    ? 'border-emerald-500/40 bg-emerald-500/5'
                    : 'border-border/60',
                )}
              >
                <div className="flex items-center gap-2">
                  <Icon className={cn('h-5 w-5', tier.accent)} aria-hidden="true" />
                  {tier.badge && (
                    <Badge
                      className={cn(
                        'ml-auto px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                        tier.badge.tone === 'live'
                          ? 'bg-emerald-500 text-emerald-50'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {tier.badge.label}
                    </Badge>
                  )}
                </div>
                <div className="text-sm font-semibold leading-tight text-foreground">
                  {tier.title}
                </div>
                <div className="text-xs font-medium text-muted-foreground">
                  {tier.subtitle}
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground/80">
                  {tier.detail}
                </p>
              </motion.div>
              {idx < TIERS.length - 1 && (
                <div
                  className="flex shrink-0 items-center justify-center text-muted-foreground md:rotate-0"
                  aria-hidden="true"
                >
                  <ArrowRight className="h-4 w-4 rotate-90 md:rotate-0" />
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div>
    </motion.section>
  )
}
