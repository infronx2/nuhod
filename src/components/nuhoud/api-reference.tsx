'use client'

import * as React from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Check, Copy } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = React.useState(false)
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard not available — fall through silently */
    }
  }
  return (
    <button
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded border border-border/60 bg-card px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      aria-label={`Copy ${label}`}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-emerald-500" aria-hidden="true" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" aria-hidden="true" />
          Copy
        </>
      )}
    </button>
  )
}

function CodeBlock({
  code,
  lang,
  label,
}: {
  code: string
  lang: string
  label: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <CopyButton text={code} label={label} />
      </div>
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
          wrapLongLines
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}

const WS_CONNECT_TS = `// Connect via the Caddy gateway. NEVER hard-code the port in the URL —
// the gateway rewrites ?XTransformPort=8001 to localhost:8001.
const host = window.location.host;
const url = \`ws://\${host}/ws/track?XTransformPort=8001&limb=right&target_angle=90&compensation_threshold=0.05\`;
const ws = new WebSocket(url);

ws.onopen = () => console.log('connected');
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'tracking') {
    // { command, elbow_angle, rep_count, score, landmarks, ... }
    onTracking(msg);
  } else if (msg.type === 'error') {
    // { code, message }
    onError(msg);
  } else if (msg.type === 'config_ack') {
    onConfigAck(msg);
  }
};`

const WS_SEND_FRAME_TS = `// Capture a frame from the UE5 camera component, encode to JPEG base64,
// and send it. The backend strips the data URI prefix automatically.
const canvas = captureCameraFrame();   // your UE5 → canvas bridge
const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
const image = dataUrl.split(',')[1] ?? dataUrl;  // raw base64 OK too

ws.send(JSON.stringify({ type: 'frame', image }));

// Throttle to ~10–15 fps; the inference server runs at ~78 fps headroom.`

const WS_SEND_CONFIG_TS = `// Reconfigure mid-session. All three fields are optional but the
// server applies only the ones you send (it's an idempotent config replace).
ws.send(JSON.stringify({
  type: 'config',
  target_angle: 90,            // 0..180
  limb: 'right',                // 'right' | 'left'
  compensation_threshold: 0.05, // normalized Y units, 0.01..0.20
}));`

const REST_FETCH_TS = `// All REST endpoints use the same gateway query param.
const stats = await fetch('/api/v1/stats?XTransformPort=8001').then(r => r.json());
//  { count, total_reps, total_correct_reps, total_score, accuracy_pct }

const sessions = await fetch('/api/v1/sessions?XTransformPort=8001').then(r => r.json());
//  { count, sessions: [{ id, patient_id, session_date, total_reps, ... }] }`

const REST_POST_TS = `// Save a completed session. The POST body is JSON.
await fetch('/api/v1/sessions?XTransformPort=8001', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    patient_id: 'demo_patient',
    duration_seconds: 120,
    total_reps: 10,
    correct_reps: 8,
    max_achieved_angle: 145,
    compensation_errors: 2,
    gamification_score: 86,
  }),
});`

const PROTOCOL_JSON = `{
  "type": "tracking",
  "elbow_angle": 45.5,
  "target_angle": 90,
  "target_reached": false,
  "compensation_detected": false,
  "command": "KEEP_GOING",
  "rep_count": 0,
  "score": 0,
  "max_achieved_angle": 45.5,
  "compensation_errors": 0,
  "visibility": 0.93,
  "landmarks": {
    "shoulder": [0.4, 0.3],
    "elbow": [0.5, 0.5],
    "wrist": [0.6, 0.7]
  },
  "latency_ms": 12.3,
  "fps_avg": 78.8,
  "timestamp": 1700000000.123
}`

export function ApiReference() {
  return (
    <section
      aria-label="API reference"
      className="rounded-xl border border-border/60 bg-card/40 p-4 sm:p-6"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            API Reference
          </h2>
          <p className="text-sm text-muted-foreground">
            The UE5 integration guide — the wire protocol the game client must implement.
          </p>
        </div>
        <Badge variant="outline" className="text-emerald-500">
          ws:// · /ws/track
        </Badge>
      </div>

      <Tabs defaultValue="ws" className="w-full">
        <TabsList>
          <TabsTrigger value="ws" className="text-xs">WebSocket</TabsTrigger>
          <TabsTrigger value="rest" className="text-xs">REST</TabsTrigger>
          <TabsTrigger value="protocol" className="text-xs">Protocol</TabsTrigger>
        </TabsList>

        <TabsContent value="ws" className="mt-4">
          <Accordion type="multiple" defaultValue={['connect']} className="w-full">
            <AccordionItem value="connect">
              <AccordionTrigger className="text-sm">
                1. Connect — <code className="text-xs text-primary">ws://{`{host}`}/ws/track?XTransformPort=8001</code>
              </AccordionTrigger>
              <AccordionContent>
                <CodeBlock
                  label="TypeScript · connect"
                  lang="typescript"
                  code={WS_CONNECT_TS}
                />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="frame">
              <AccordionTrigger className="text-sm">
                2. Send frame — <code className="text-xs text-primary">{`{type:'frame', image}`}</code>
              </AccordionTrigger>
              <AccordionContent>
                <CodeBlock
                  label="TypeScript · send frame"
                  lang="typescript"
                  code={WS_SEND_FRAME_TS}
                />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="config">
              <AccordionTrigger className="text-sm">
                3. Send config — <code className="text-xs text-primary">{`{type:'config', ...}`}</code>
              </AccordionTrigger>
              <AccordionContent>
                <CodeBlock
                  label="TypeScript · send config"
                  lang="typescript"
                  code={WS_SEND_CONFIG_TS}
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </TabsContent>

        <TabsContent value="rest" className="mt-4">
          <Accordion type="multiple" defaultValue={['fetch']} className="w-full">
            <AccordionItem value="fetch">
              <AccordionTrigger className="text-sm">
                GET <code className="text-xs text-emerald-500">/api/v1/stats</code> ·{' '}
                <code className="text-xs text-emerald-500">/api/v1/sessions</code>
              </AccordionTrigger>
              <AccordionContent>
                <CodeBlock
                  label="TypeScript · fetch stats + sessions"
                  lang="typescript"
                  code={REST_FETCH_TS}
                />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="post">
              <AccordionTrigger className="text-sm">
                POST <code className="text-xs text-emerald-500">/api/v1/sessions</code>
              </AccordionTrigger>
              <AccordionContent>
                <CodeBlock
                  label="TypeScript · save a session"
                  lang="typescript"
                  code={REST_POST_TS}
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </TabsContent>

        <TabsContent value="protocol" className="mt-4">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The authoritative <code className="text-xs">tracking</code> message shape sent
              by the server after every frame.
            </p>
            <CodeBlock label="JSON · tracking message" lang="json" code={PROTOCOL_JSON} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className={cn('rounded-md border border-border/60 p-3')}>
                <h4 className="text-xs font-semibold text-emerald-500">Server → Client</h4>
                <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                  <li><code className="font-mono text-foreground">tracking</code> — pose + verdict (per frame)</li>
                  <li><code className="font-mono text-foreground">error</code> — <code>{`{code, message}`}</code> (e.g. NO_POSE)</li>
                  <li><code className="font-mono text-foreground">config_ack</code> — confirms a config update</li>
                </ul>
              </div>
              <div className="rounded-md border border-border/60 p-3">
                <h4 className="text-xs font-semibold text-primary">Client → Server</h4>
                <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                  <li><code className="font-mono text-foreground">{`{type:'frame', image}`}</code> — base64 JPEG</li>
                  <li><code className="font-mono text-foreground">{`{type:'config', ...}`}</code> — reconfigure</li>
                </ul>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  )
}
