import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'

/**
 * GET /api/v2/sessions/fhir-bundle?patientId=X&days=30
 *
 * Exports a batch of a patient's recent sessions as a single HL7 FHIR R4
 * Bundle resource (type: collection). Each entry is a full Observation
 * resource (same shape as GET /api/v2/sessions/[id]/fhir). This lets a
 * hospital EHR ingest a patient's whole rehab history in one POST.
 *
 * Auth: the patient themselves, or any doctor/admin.
 *
 * Query params:
 *  - patientId (required): the patient whose sessions to bundle.
 *  - days (default 30): how many days back to include.
 *  - limit (default 100): max entries.
 */
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const url = new URL(req.url)
  const patientId = url.searchParams.get('patientId')
  if (!patientId) {
    return NextResponse.json({ ok: false, error: 'patientId is required' }, { status: 400 })
  }
  const isDoctor = payload.role.toUpperCase() === 'DOCTOR' || payload.role.toUpperCase() === 'ADMIN'
  if (!isDoctor && payload.sub !== patientId) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '30', 10) || 30, 1), 365)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 500)

  const since = new Date()
  since.setDate(since.getDate() - days)

  const [patient, sessions] = await Promise.all([
    db.user.findUnique({
      where: { id: patientId },
      select: { id: true, name: true },
    }),
    db.rehabSession.findMany({
      where: { patientId, sessionDate: { gte: since } },
      orderBy: { sessionDate: 'asc' },
      take: limit,
      include: { plan: { select: { title: true } } },
    }),
  ])

  if (!patient) {
    return NextResponse.json({ ok: false, error: 'patient not found' }, { status: 404 })
  }

  // Build the FHIR Bundle.
  const bundle = {
    resourceType: 'Bundle',
    id: `nuhoud-bundle-${patientId}-${Date.now()}`,
    type: 'collection',
    timestamp: new Date().toISOString(),
    total: sessions.length,
    // A Bundle entry wraps each Observation with a fullUrl + the resource.
    entry: sessions.map((s) => ({
      fullUrl: `urn:uuid:${s.id}`,
      resource: {
        resourceType: 'Observation',
        id: s.id,
        status: 'final',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'therapy',
                display: 'Therapy',
              },
            ],
          },
        ],
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '71033-6',
              display: 'Upper extremity range of motion',
            },
          ],
          text: `Nuhoud ${s.limb} elbow flexion rehab session`,
        },
        subject: {
          reference: `Patient/${s.patientId}`,
          display: patient.name,
        },
        effectiveDateTime: s.sessionDate.toISOString(),
        valueQuantity: {
          value: Number(s.maxAchievedAngle.toFixed(2)),
          unit: 'degrees',
          system: 'http://unitsofmeasure.org',
          code: 'deg',
        },
        component: [
          {
            code: { text: 'Repetition Count' },
            valueInteger: s.totalReps,
          },
          {
            code: { text: 'Correct Repetitions' },
            valueInteger: s.correctReps,
          },
          {
            code: { text: 'Compensation Errors' },
            valueInteger: s.compensationErrors,
          },
          {
            code: { text: 'Session Duration' },
            valueQuantity: { value: s.durationSeconds, unit: 's', system: 'http://unitsofmeasure.org', code: 's' },
          },
          {
            code: { text: 'Gamification Score' },
            valueInteger: s.gamificationScore,
          },
        ],
        note: s.plan?.title
          ? [{ text: `Prescribed under plan: ${s.plan.title}` }]
          : [{ text: 'Source: Nuhoud digital therapeutic platform' }],
        meta: {
          tag: [
            {
              system: 'https://nuhoud.health',
              code: 'nuhoud',
              display: 'Nuhoud',
            },
          ],
          lastUpdated: s.createdAt.toISOString(),
        },
      },
    })),
  }

  return NextResponse.json({
    ok: true,
    bundle,
    summary: {
      patientId,
      patientName: patient.name,
      sessionsBundled: sessions.length,
      daysCovered: days,
      generatedAt: new Date().toISOString(),
    },
  })
}
