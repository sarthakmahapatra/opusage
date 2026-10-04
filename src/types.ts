/** A session row as stored in OpenCode's `session_v2` table. */
export interface SessionRow {
  id: string
  project_id: string
  parent_id: string | null
  title: string | null
  agent: string | null
  model: string | null
  cost: number
  tokens_input: number
  tokens_output: number
  tokens_reasoning: number
  tokens_cache_read: number
  tokens_cache_write: number
  time_created: number
  time_updated: number
}

export interface ProjectRow {
  id: string
  worktree: string
  name: string | null
}

/** A model reference as stored in the `model` JSON column. */
export interface ModelRef {
  id: string
  providerID: string
  variant?: string
}

/** Aggregated token + cost totals. */
export interface Usage {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export function emptyUsage(): Usage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
}

/** Sum of all token counters (total context transferred). */
export function totalTokens(u: Usage): number {
  return u.input + u.output + u.reasoning + u.cacheRead + u.cacheWrite
}

/** Prompt-cache hit rate: cached reads vs (new input + cached reads). */
export function cacheHitRate(u: Usage): number {
  const denom = u.input + u.cacheRead
  return denom === 0 ? 0 : u.cacheRead / denom
}

/** The usage-bearing fields of a session row. */
export interface UsageLike {
  tokens_input: number
  tokens_output: number
  tokens_reasoning: number
  tokens_cache_read: number
  tokens_cache_write: number
  cost: number
}

/** Add one session's counters into an accumulator. */
export function addSession(u: Usage, s: UsageLike): void {
  u.input += s.tokens_input
  u.output += s.tokens_output
  u.reasoning += s.tokens_reasoning
  u.cacheRead += s.tokens_cache_read
  u.cacheWrite += s.tokens_cache_write
  u.cost += s.cost
}
