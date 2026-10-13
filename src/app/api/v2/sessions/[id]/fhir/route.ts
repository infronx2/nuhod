import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'

/**
 * GET /api/v2/sessions/[id]/fhir
 *
 * Converts a RehabSession into an HL7 FHIR R4 Observation resource, ready to
 * POST to a hospital EHR. This is the Phase 3 integration deliverable, exposed
 * early so clinicians can preview the payload shape.
 *
 * Reference: https://hl7.org/fhir/observation.html
 * LOINC 71033-6 = "Upper extremity range of motion"
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  const { id } = await ctx.params

  const session = await db.rehabSession.findUnique({
    where: { id },
    include: { patient: true, plan: true },
  })
  if (!session) {
    return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })
  }

  const isDoctor = payload.role.toUpperCase() === 'DOCTOR' || payload.role.toUpperCase() === 'ADMIN'
  if (!isDoctor && payload.sub !== session.patientId) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const fhir = {
    resourceType: 'Observation',
    id: session.id,
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
      text: `Nuhoud ${session.limb} elbow flexion rehab session`,
    },
    subject: {
      reference: `Patient/${session.patientId}`,
      display: session.patient.name,
    },
    performer: [
      {
        reference: `Patient/${session.patientId}`,
        display: session.patient.name,
      },
    ],
    effectiveDateTime: session.sessionDate.toISOString(),
    issued: session.createdAt.toISOString(),
    valueQuantity: {
      value: Number(session.maxAchievedAngle.toFixed(2)),
      unit: 'degrees',
      system: 'http://unitsofmeasure.org',
      code: 'deg',
    },
    component: [
      {
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '71715-8',
              display: 'Repetition count',
            },
          ],
          text: 'Repetition Count',
        },
        valueInteger: session.totalReps,
      },
      {
        code: {
          coding: [
            {
              system: 'http://snomed.info/sct',
              code: '405415000',
              display: 'Procedure withheld (situation)',
            },
          ],
          text: 'Correct Repetitions',
        },
        valueInteger: session.correctReps,
      },
      {
        code: {
          text: 'Compensation Errors',
        },
        valueInteger: session.compensationErrors,
      },
      {
        code: {
          text: 'Session Duration',
        },
        valueQuantity: {
          value: session.durationSeconds,
          unit: 's',
          system: 'http://unitsofmeasure.org',
          code: 's',
        },
      },
      {
        code: {
          text: 'Gamification Score',
        },
        valueInteger: session.gamificationScore,
      },
    ],
    note: session.plan?.title
      ? [{ text: `Prescribed under plan: ${session.plan.title}` }]
      : [{ text: 'Source: Nuhoud digital therapeutic platform' }],
    meta: {
      tag: [
        {
          system: 'https://nuhoud.health',
          code: 'nuhoud',
          display: 'Nuhoud',
        },
      ],
      lastUpdated: session.createdAt.toISOString(),
    },
  }

  return NextResponse.json({
    ok: true,
    fhir,
    session: {
      id: session.id,
      patientId: session.patientId,
      sessionDate: session.sessionDate,
      limb: session.limb,
    },
  })
}
