'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { Package, Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'

interface FhirBundleButtonProps {
  patientId: string
  patientName?: string
  days?: number
}

/**
 * FhirBundleButton — fetches a FHIR R4 Bundle of the patient's recent
 * sessions and downloads it as a .json file. Used on the patient detail
 * page so a doctor can export a patient's whole rehab history for the
 * hospital EHR in one click.
 */
export function FhirBundleButton({ patientId, patientName, days = 30 }: FhirBundleButtonProps) {
  const [loading, setLoading] = React.useState(false)

  const handleExport = async () => {
    setLoading(true)
    try {
      const data = await apiFetch<{
        ok: boolean
        bundle: any
        summary: { sessionsBundled: number }
      }>(`/api/v2/sessions/fhir-bundle?patientId=${patientId}&days=${days}`)
      if (!data.ok) throw new Error('export failed')
      const json = JSON.stringify(data.bundle, null, 2)
      const blob = new Blob([json], { type: 'application/fhir+json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `fhir-bundle-${patientId}-${days}d.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('FHIR Bundle exported', {
        description: `${data.summary.sessionsBundled} sessions from the last ${days} days.`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'export failed'
      toast.error('Bundle export failed', { description: msg })
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 border-primary/40 text-primary hover:bg-primary/5 dark:text-primary"
        onClick={handleExport}
        disabled={loading}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
        Export FHIR Bundle
      </Button>
    </motion.div>
  )
}
