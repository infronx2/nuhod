'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Check, Stethoscope } from 'lucide-react'
import { NeuronMark } from '@/components/nuhoud/neuron-mark'

/**
 * AuthHero — the sign-in page's brand panel: the promise, three facts, and a small stack of
 * floating preview cards (a live angle reading, today's session, the doctor's review) that tilt
 * with the pointer through DepthLayer ([data-tilt]).
 */
export function AuthHero() {
  const t = useTranslations('auth')
  const tc = useTranslations('common')
  const rise = (delay: number) => ({
    initial: { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { delay, duration: 0.6, ease: [0.2, 0.7, 0.2, 1] as const },
  })

  return (
    <div className="relative hidden overflow-hidden bg-[#0B3E46] text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
      {/* Soft light from above and a faint grid: depth without decoration. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_80%_-10%,rgb(59_179_189/0.35),transparent_70%)]" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '48px 48px' }}
        aria-hidden="true"
      />

      <motion.div {...rise(0)} className="relative z-10 flex items-center gap-3">
        <NeuronMark className="h-11 w-11 text-[#7FD8DE]" />
        <span className="text-2xl font-semibold">{tc('appName')}</span>
      </motion.div>

      <div className="relative z-10 grid grid-cols-[1fr_auto] items-center gap-10">
        <div className="flex flex-col gap-5">
          <motion.h1 {...rise(0.1)} className="max-w-md text-[2.6rem] font-semibold leading-[1.2]">
            {t('heroHeadline')}{' '}
            <span className="text-[#7FD8DE]">{t('heroHighlight')}</span>
          </motion.h1>
          <motion.p {...rise(0.2)} className="max-w-md text-[15px] leading-relaxed text-white/75">
            {t('heroDescription')}
          </motion.p>
          <motion.ul {...rise(0.3)} className="flex flex-col gap-2.5 text-sm text-white/85">
            {[t('feature1'), t('feature2'), t('feature3')].map((f) => (
              <li key={f} className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15">
                  <Check className="h-3 w-3" />
                </span>
                {f}
              </li>
            ))}
          </motion.ul>
        </div>

        {/* Floating preview stack */}
        <div className="relative hidden h-[22rem] w-64 xl:block" style={{ perspective: '1100px' }}>
          <motion.div
            {...rise(0.35)}
            data-tilt
            className="absolute end-0 top-0 w-60 rounded-3xl border border-white/15 bg-white/10 p-5 shadow-[0_30px_60px_-25px_rgb(0_0_0/0.6)] backdrop-blur-md"
          >
            <p className="text-xs text-white/70">{t('previewAngle')}</p>
            <div data-depth className="mt-3 flex items-center gap-4">
              <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
                <circle cx="40" cy="40" r="32" fill="none" stroke="rgb(255 255 255 / 0.15)" strokeWidth="8" />
                <circle cx="40" cy="40" r="32" fill="none" stroke="#7FD8DE" strokeWidth="8" strokeLinecap="round" pathLength="100" strokeDasharray="41 100" />
              </svg>
              <div>
                <p className="text-3xl font-semibold tabular-nums">74°</p>
                <p className="text-xs text-white/60">{t('previewTarget')} 80°</p>
              </div>
            </div>
          </motion.div>
          <motion.div
            {...rise(0.5)}
            data-tilt
            className="absolute end-12 top-40 w-56 rounded-3xl border border-white/15 bg-white p-5 text-[#0D2233] shadow-[0_30px_60px_-20px_rgb(0_0_0/0.55)]"
          >
            <p className="text-xs text-[#5E7182]">{t('previewSession')}</p>
            <div data-depth className="mt-2 flex items-end justify-between">
              <div>
                <p className="text-3xl font-semibold tabular-nums">12</p>
                <p className="text-xs text-[#5E7182]">{t('previewReps')}</p>
              </div>
              <div className="text-end">
                <p className="text-lg font-semibold tabular-nums text-[#0F7C86]">82%</p>
                <p className="text-xs text-[#5E7182]">{t('previewGrip')}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-[#E2F3F1] px-3 py-2 text-xs font-medium text-[#0B5F66]">
              <Stethoscope className="h-3.5 w-3.5" />
              {t('previewReviewed')}
            </div>
          </motion.div>
        </div>
      </div>

      <motion.div {...rise(0.4)} className="relative z-10 text-xs text-white/50">{t('phaseLabel')}</motion.div>
    </div>
  )
}
