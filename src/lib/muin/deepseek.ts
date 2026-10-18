/**
 * Minimal DeepSeek client (OpenAI-compatible chat completions with tool calling).
 *
 * Configuration (server-side only):
 * - DEEPSEEK_API_KEY   required; without it every call returns null and Mu'in uses its fallbacks
 * - DEEPSEEK_MODEL     optional, default "deepseek-flash" (the cheapest model)
 * - DEEPSEEK_BASE_URL  optional, default "https://api.deepseek.com"
 */

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ToolSpec {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

const TIMEOUT_MS = 25_000

export function deepseekConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY
}

/** One completion. Returns the assistant message, or null when DeepSeek is not configured or fails. */
export async function complete(
  messages: LlmMessage[],
  opts: { tools?: ToolSpec[]; maxTokens?: number; temperature?: number } = {},
): Promise<{ content: string | null; tool_calls?: ToolCall[] } | null> {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) return null
  const base = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '')
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
        // No thinking mode: reasoning tokens are billed and these replies are short.
        reasoning_effort: 'none',
        messages,
        ...(opts.tools?.length ? { tools: opts.tools } : {}),
        max_tokens: opts.maxTokens ?? 300,
        temperature: opts.temperature ?? 0.6,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error('[muin] DeepSeek HTTP', res.status, (await res.text()).slice(0, 300))
      return null
    }
    const data = await res.json()
    const u = data?.usage
    if (u) {
      console.log(`[muin] tokens in ${u.prompt_tokens} (cache hit ${u.prompt_cache_hit_tokens ?? 0}) out ${u.completion_tokens}`)
    }
    const msg = data?.choices?.[0]?.message
    if (!msg) return null
    return { content: msg.content ?? null, tool_calls: msg.tool_calls }
  } catch (err) {
    console.error('[muin] DeepSeek call failed', err instanceof Error ? err.message : err)
    return null
  }
}
