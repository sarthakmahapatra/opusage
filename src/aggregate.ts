import type { ModelRef, ProjectRow, SessionRow, Usage } from "./types.ts"
import { addSession, cacheHitRate, emptyUsage, totalTokens } from "./types.ts"

/** A top-level session with all of its descendants (sub-agents) rolled up. */
export interface RootSession {
  id: string
  project_id: string
  title: string | null
  model: ModelRef | null
  time_created: number
  time_updated: number
  usage: Usage
  /** How many raw sessions (including the root) contributed to this row. */
  members: number
}

/** A labeled aggregate row for a grouped view. */
export interface GroupRow {
  label: string
  sub?: string
  sessions: number
  usage: Usage
}

/** Parse the `model` JSON column into a ModelRef. */
export function parseModel(json: string | null): ModelRef | null {
  if (!json) return null
  try {
    const m = JSON.parse(json) as Record<string, unknown>
    if (typeof m.id === "string" && typeof m.providerID === "string") {
      return { id: m.id, providerID: m.providerID, variant: typeof m.variant === "string" ? m.variant : undefined }
    }
  } catch {
    // unparseable — treat as unknown
  }
  return null
}

/** Human-readable `provider/id#variant` label. */
export function modelLabel(m: ModelRef | null): string {
  if (!m) return "unknown"
  return `${m.providerID}/${m.id}${m.variant ? `#${m.variant}` : ""}`
}

/**
 * Collapse every session into its root, attributing sub-agent usage to the
 * root session. Walks `parent_id` with a visited set so malformed cycles
 * cannot loop forever.
 */
export function rollupFamilies(rows: SessionRow[]): RootSession[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const roots = new Map<string, RootSession>()

  const rootOf = (id: string): string => {
    const seen = new Set<string>()
    let cur = id
    for (;;) {
      if (seen.has(cur)) return cur
      seen.add(cur)
      const row = byId.get(cur)
      if (!row || !row.parent_id) return cur
      cur = row.parent_id
    }
  }

  for (const row of rows) {
    const rootId = rootOf(row.id)
    let root = roots.get(rootId)
    if (!root) {
      const r = byId.get(rootId) ?? row
      root = {
        id: r.id,
        project_id: r.project_id,
        title: r.title,
        model: parseModel(r.model),
        time_created: r.time_created,
        time_updated: r.time_updated,
        usage: emptyUsage(),
        members: 0,
      }
      roots.set(rootId, root)
    }
    addSession(root.usage, row)
    root.members += 1
    root.time_updated = Math.max(root.time_updated, row.time_updated)
  }

  return [...roots.values()]
}

/**
 * Keep sessions inside the time window.
 * @param since  epoch milliseconds; null means all time
 * @param active match on last activity instead of session start
 */
export function filterWindow(roots: RootSession[], since: number | null, active: boolean): RootSession[] {
  if (since === null) return roots
  return roots.filter((r) => (active ? r.time_updated : r.time_created) >= since)
}

export function filterProject(roots: RootSession[], projectId: string): RootSession[] {
  return roots.filter((r) => r.project_id === projectId)
}

/** Resolve a `--project` argument (path, ".", name, or id) to a project id. */
export function resolveProjectId(projects: ProjectRow[], spec: string): string | null {
  // Normalize separators so "." and path specs work on Windows (C:\...) and POSIX.
  const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase()
  if (spec === ".") {
    const cwd = norm(process.cwd())
    let best: ProjectRow | null = null
    for (const p of projects) {
      const w = norm(p.worktree)
      if (cwd === w || cwd.startsWith(w + "/")) {
        if (!best || p.worktree.length > best.worktree.length) best = p
      }
    }
    return best?.id ?? null
  }
  const s = spec.toLowerCase()
  const found =
    projects.find((p) => p.id === spec) ??
    projects.find((p) => (p.name ?? "").toLowerCase() === s) ??
    projects.find((p) => norm(p.worktree).includes(s))
  return found?.id ?? null
}

export function byProject(roots: RootSession[], projects: ProjectRow[]): GroupRow[] {
  const names = new Map(projects.map((p) => [p.id, p.name ?? pathBasename(p.worktree)]))
  const groups = new Map<string, GroupRow>()
  for (const r of roots) {
    let g = groups.get(r.project_id)
    if (!g) {
      const p = projects.find((x) => x.id === r.project_id)
      g = {
        label: names.get(r.project_id) ?? r.project_id,
        sub: p?.worktree,
        sessions: 0,
        usage: emptyUsage(),
      }
      groups.set(r.project_id, g)
    }
    addSession(g.usage, rowFromRoot(r))
    g.sessions += 1
  }
  return sortGroups([...groups.values()])
}

export function byModel(roots: RootSession[]): GroupRow[] {
  const groups = new Map<string, GroupRow>()
  for (const r of roots) {
    const label = modelLabel(r.model)
    let g = groups.get(label)
    if (!g) {
      g = { label, sessions: 0, usage: emptyUsage() }
      groups.set(label, g)
    }
    addSession(g.usage, rowFromRoot(r))
    g.sessions += 1
  }
  return sortGroups([...groups.values()])
}

/** One session as a GroupRow, for the per-session view. */
export function sessionRows(roots: RootSession[], projects: ProjectRow[], top: number): GroupRow[] {
  const names = new Map(projects.map((p) => [p.id, pathBasename(p.worktree)]))
  return roots
    .map((r) => {
      const g: GroupRow = {
        label: r.title ?? r.id,
        sub: `${r.id} · ${names.get(r.project_id) ?? r.project_id} · ${modelLabel(r.model)}`,
        sessions: r.members,
        usage: { ...r.usage },
      }
      return g
    })
    .sort((a, b) => totalTokens(b.usage) - totalTokens(a.usage))
    .slice(0, top)
}

function sortGroups(groups: GroupRow[]): GroupRow[] {
  return groups.sort((a, b) => totalTokens(b.usage) - totalTokens(a.usage))
}

/** Adapt a RootSession into a SessionRow-shaped object for addSession(). */
function rowFromRoot(r: RootSession): { tokens_input: number; tokens_output: number; tokens_reasoning: number; tokens_cache_read: number; tokens_cache_write: number; cost: number } {
  return {
    tokens_input: r.usage.input,
    tokens_output: r.usage.output,
    tokens_reasoning: r.usage.reasoning,
    tokens_cache_read: r.usage.cacheRead,
    tokens_cache_write: r.usage.cacheWrite,
    cost: r.usage.cost,
  }
}

function pathBasename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || p
}
