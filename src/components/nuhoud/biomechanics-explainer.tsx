'use client'

import * as React from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const ANGLE_PY = `def calculate_angle(a, b, c):
    """
    Planar joint angle at point b, given three 2D landmarks.

    Uses atan2 (signed angle, robust to quadrant) and folds the result
    into the canonical [0, 180°] range so the angle is always reported
    as a flexion angle (no negative numbers, no >180° wrap-around).

    a, b, c are (x, y) tuples in normalized MediaPipe coordinates.
    """
    a = np.array(a, dtype=float)
    b = np.array(b, dtype=float)
    c = np.array(c, dtype=float)

    # Vectors from the elbow (b) to shoulder (a) and wrist (c).
    ba = a - b
    bc = c - b

    # atan2(signed angle) is preferred over acos because:
    #  * acos has a numerically unstable derivative near 0° and 180°,
    #  * atan2 keeps full precision at the boundaries that matter most
    #    for elbow flexion (full extension ~180°, full flexion ~20°).
    cosine = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-9)
    cosine = np.clip(cosine, -1.0, 1.0)
    angle = np.degrees(np.arccos(cosine))

    # Fold to [0, 180]. Elbow flexion is always positive by anatomy.
    return float(min(180.0, max(0.0, angle)))`

const COMP_PY = `# Compensation detector — rolling-baseline shoulder shrug.
#
# When a patient has weakness in the affected arm they often recruit
# the upper trapezius by shrugging the shoulder. MediaPipe returns
# shoulder Y as a normalized 0..1 coordinate (0 = top of frame).
# A "shrug" lifts the shoulder upward → smaller Y.
#
# Hard-coded pixel thresholds are brittle (they depend on camera
# framing and patient height). Instead we capture a rolling baseline
# of the relaxed shoulder Y while the arm is at rest, and trigger
# CORRECT_POSTURE when the current Y deviates upward beyond the
# compensation_threshold (normalized units, typical 0.03–0.10).
SHOULDER_BASELINE = collections.deque(maxlen=30)  # ~1 s of relaxed frames

def detect_shrug(shoulder_y, threshold=0.05):
    if len(SHOULDER_BASELINE) < 10:
        # Warm-up: learn the relaxed posture before judging.
        SHOULDER_BASELINE.append(shoulder_y)
        return False
    baseline = sum(SHOULDER_BASELINE) / len(SHOULDER_BASELINE)
    delta = baseline - shoulder_y  # positive when shoulder moved UP
    if delta > threshold:
        return True  # shrug detected
    # Re-anchor the baseline toward the new position so the detector
    # adapts if the patient deliberately moves their whole body.
    SHOULDER_BASELINE.append(shoulder_y)
    return False`

const REP_PY = `# Hysteresis rep counter (extended -> flexed past target -> extended = 1 rep).
#
# Without hysteresis, near-target jitter would double- or triple-count
# a single repetition. We use a 3-state machine:
#   STATE_EXTENDED  -> angle below EXTENDED_FLOOR (e.g. target * 0.4)
#   STATE_FLEXING   -> angle rising past target
#   STATE_EXTENDED  (reset) only after returning below EXTENDED_FLOOR
STATE = "EXTENDED"
REP_COUNT = 0

def update_rep(angle, target_angle, compensated):
    global STATE, REP_COUNT
    if STATE == "EXTENDED" and angle >= target_angle:
        STATE = "FLEXED"
        REP_COUNT += 1
        # Scoring: clean rep = 10 pts, compensated rep = 3 pts.
        return 3 if compensated else 10
    if STATE == "FLEXED" and angle <= target_angle * 0.4:
        STATE = "EXTENDED"  # arm returned to start — ready for next rep
    return 0`

const COMMANDS: Array<{
  cmd: string
  tone: string
  clinical: string
}> = [
  {
    cmd: 'KEEP_GOING',
    tone: 'text-primary',
    clinical: 'The patient is flexing toward the target but has not yet reached it. Verbal cue: "keep going".',
  },
  {
    cmd: 'HOLD',
    tone: 'text-amber-400',
    clinical: 'The patient has reached or passed the target angle. Hold this position briefly to recruit a sustained muscle contraction (active-assisted isometric).',
  },
  {
    cmd: 'TARGET_HIT',
    tone: 'text-emerald-400',
    clinical: 'The target was reached cleanly (no compensation). One repetition is counted; the gamification layer awards 10 points.',
  },
  {
    cmd: 'CORRECT_POSTURE',
    tone: 'text-rose-400',
    clinical: 'Compensatory shoulder shrugging was detected. Stop, relax the trapezius, and retry. Compensated reps still count but score only 3 points.',
  },
  {
    cmd: 'NO_POSE',
    tone: 'text-slate-400',
    clinical: 'MediaPipe could not detect a confident pose — patient out of frame, poor lighting, or occlusion. Inference is paused; no rep is recorded.',
  },
]

function TriangleDiagram() {
  return (
    <svg
      viewBox="0 0 240 160"
      className="h-32 w-full max-w-xs"
      role="img"
      aria-label="Shoulder, elbow, wrist triangle with elbow angle arc"
    >
      {/* triangle */}
      <polygon
        points="40,130 120,40 200,130"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-primary"
      />
      {/* angle arc at elbow (vertex at top) */}
      <path
        d="M 100 55 A 22 22 0 0 1 140 55"
        fill="none"
        stroke="#f59e0b"
        strokeWidth="2.5"
      />
      {/* labels */}
      <text x="32" y="148" fill="currentColor" className="fill-foreground text-[10px] font-mono">
        shoulder (a)
      </text>
      <text x="100" y="32" fill="currentColor" className="fill-amber-500 text-[10px] font-mono">
        elbow (b) · θ
      </text>
      <text x="174" y="148" fill="currentColor" className="fill-foreground text-[10px] font-mono">
        wrist (c)
      </text>
      {/* joints */}
      <circle cx="40" cy="130" r="4" fill="#34d399" />
      <circle cx="120" cy="40" r="4" fill="#f59e0b" />
      <circle cx="200" cy="130" r="4" fill="#f472b6" />
    </svg>
  )
}

function CodeBlock({ code, lang = 'python' }: { code: string; lang?: string }) {
  return (
    <div className="nm-scroll-thin overflow-x-auto rounded-md border border-border/60">
      <SyntaxHighlighter
        language={lang}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: '12px',
          fontSize: '12px',
          background: 'rgba(2, 6, 23, 0.7)',
        }}
        showLineNumbers
        lineNumberStyle={{ color: '#475569', minWidth: '2em' }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

export function BiomechanicsExplainer() {
  return (
    <section
      aria-label="Biomechanics explainer"
      className="rounded-xl border border-border/60 bg-card/40 p-4 sm:p-6"
    >
      <div className="mb-3">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Biomechanics Explainer
        </h2>
        <p className="text-sm text-muted-foreground">
          How the angles, compensation and reps are computed — for clinicians.
        </p>
      </div>

      <Accordion type="single" collapsible defaultValue="angle" className="w-full">
        <AccordionItem value="angle">
          <AccordionTrigger className="text-sm font-medium">
            1. Joint-angle math · <code className="text-xs text-primary">calculate_angle(a, b, c)</code>
          </AccordionTrigger>
          <AccordionContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-center rounded-md border border-border/60 bg-slate-950/50 p-3">
                <TriangleDiagram />
              </div>
              <div className="text-sm text-muted-foreground">
                <p>
                  The elbow angle is the planar angle at vertex <b>elbow (b)</b> formed by the
                  three MediaPipe landmarks: shoulder, elbow, wrist. We use{' '}
                  <span className="font-mono text-foreground">arccos(clip(dot(ba, bc) / (|ba|·|bc|)))</span>{' '}
                  which is the standard atan2-equivalent angle and is numerically stable once
                  the cosine is clamped to [−1, 1].
                </p>
                <p className="mt-2">
                  The result is folded into the canonical flexion range [0°, 180°] so it is
                  always reported as a positive flexion angle (anatomically the elbow never
                  flexes past ~150°, but the code tolerates full extension).
                </p>
              </div>
            </div>
            <CodeBlock code={ANGLE_PY} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="compensation">
          <AccordionTrigger className="text-sm font-medium">
            2. Compensation detection · rolling-baseline shrug detector
          </AccordionTrigger>
          <AccordionContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Patients with hemiparetic arm weakness often substitute upper-trapezius
              shrugging for true glenohumeral flexion. MediaPipe reports shoulder Y as a
              normalized 0–1 coordinate; a shrug lifts the shoulder upward (smaller Y). A
              hard-coded pixel threshold would be brittle, so we maintain a 30-frame
              rolling baseline of the <i>relaxed</i> shoulder Y and trigger{' '}
              <span className="font-mono text-rose-500">CORRECT_POSTURE</span> only when the
              current Y deviates upward beyond <code>compensation_threshold</code> (normalized
              units, typical 0.03–0.10).
            </p>
            <CodeBlock code={COMP_PY} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="rep">
          <AccordionTrigger className="text-sm font-medium">
            3. Hysteresis rep counter
          </AccordionTrigger>
          <AccordionContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Without hysteresis, jitter near the target angle would double-count
              repetitions. We use a 3-state machine: <code>EXTENDED → FLEXED → EXTENDED</code>
              . A rep is counted only on the rising edge (angle crosses the target), and the
              state machine only resets to <code>EXTENDED</code> once the elbow returns past a
              low floor (<code>target × 0.4</code>). Clean reps score 10 pts; compensated reps
              score 3 pts.
            </p>
            <CodeBlock code={REP_PY} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="commands">
          <AccordionTrigger className="text-sm font-medium">
            4. The 5 commands — clinical meaning
          </AccordionTrigger>
          <AccordionContent className="space-y-2">
            <ul className="flex flex-col gap-2">
              {COMMANDS.map((c) => (
                <li
                  key={c.cmd}
                  className="flex flex-col gap-1 rounded-md border border-border/60 bg-muted/20 p-3"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn('font-mono', c.tone)}>
                      {c.cmd}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{c.clinical}</p>
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  )
}
