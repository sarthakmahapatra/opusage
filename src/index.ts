import { fail, findDbPath, loadProjects, loadSessions, openDb } from "./db.ts"
import {
  byModel,
  byProject,
  filterProject,
  filterWindow,
  resolveProjectId,
  rollupFamilies,
  sessionRows,
  type GroupRow,
  type RootSession,
} from "./aggregate.ts"
import { cacheHitRate, emptyUsage, totalTokens, type Usage } from "./types.ts"
import { clean, clip, csv, date, human, money, pct, table } from "./render.ts"

export const VERSION = "0.2.1"

interface Args {
  days?: number
  since?: string
  project?: string
  models?: boolean
  sessions?: boolean
  top: number
  format: "table" | "json" | "csv"
  db?: string
  active?: boolean
}

const HELP = `opusage v${VERSION} — token & cost usage for OpenCode

Usage:
  opusage [options]              per-project summary (default view)
  opusage --models [options]     per-model breakdown
  opusage --sessions [N] [opts]  per-session table (top N, default 15)

Time:
  --days <n>                     only sessions started in the last n days
  --since <date|epoch-ms>        only sessions started after the given time
                                 (e.g. 2026-10-01)
  --active                       with --days/--since, match on last activity
                                 instead of session start

Filter:
  --project <path|name|id>       one project only; "." = the current project

Output:
  --format <table|json|csv>      output format (default table)
  --top <n>                      max rows (default 15; 0 = all)
  --db <path>                    database file (default: auto-detected)

Other:
  -h, --help                     show this help
  -v, --version                  show version

Data source: OpenCode's local SQLite database (opencode debug paths db).
opusage is strictly read-only. Costs are whatever OpenCode recorded;
local/free providers (e.g. LM Studio) report $0.00.`

function parse(argv: string[]): Args {
  const args: Args = { top: 15, format: "table" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) fail(`missing value for ${a}`)
      return v
    }
    switch (a) {
      case "--days": {
        const n = Number(next())
        if (!Number.isFinite(n) || n < 0) fail("--days expects a number")
        args.days = n
        break
      }
      case "--since":
        args.since = next()
        break
      case "--project":
        args.project = next()
        break
      case "--top": {
        const n = Number(next())
        if (!Number.isInteger(n) || n < 0) fail("--top expects a non-negative integer")
        args.top = n
        break
      }
      case "--format": {
        const v = next()
        if (v !== "table" && v !== "json" && v !== "csv") fail("--format expects table, json, or csv")
        args.format = v
        break
      }
      case "--db":
        args.db = next()
        break
      case "--models":
        args.models = true
        break
      case "--sessions":
        args.sessions = true
        if (i + 1 < argv.length && /^\d+$/.test(argv[i + 1])) args.top = Number(argv[++i])
        break
      case "--active":
        args.active = true
        break
      case "-h":
      case "--help":
        console.log(HELP)
        process.exit(0)
        break
      case "-v":
      case "--version":
        console.log(VERSION)
        process.exit(0)
        break
      default:
        fail(`unknown argument: ${a} (see --help)`)
    }
  }
  if (args.models && args.sessions) fail("--models and --sessions are mutually exclusive")
  return args
}

function windowSince(args: Args): number | null {
  if (args.days !== undefined) return Date.now() - args.days * 86_400_000
  if (args.since !== undefined) {
    const s = args.since
    const ms = /^\d+$/.test(s) ? Number(s) : Date.parse(s)
    if (!Number.isFinite(ms)) fail(`could not parse --since value: ${args.since}`)
    return ms
  }
  return null
}

function windowLabel(args: Args, since: number | null): string {
  if (since === null) return "all time"
  if (args.days !== undefined) return `last ${args.days}d`
  return `since ${date(since)}`
}

export function main(argv: string[]): void {
  const args = parse(argv)
  const dbPath = findDbPath(args.db)
  const db = openDb(dbPath)

  let roots: RootSession[] = rollupFamilies(loadSessions(db))
  const projects = loadProjects(db)
  db.close() // everything we need is in memory; release the handle promptly

  const since = windowSince(args)
  if (since !== null) roots = filterWindow(roots, since, args.active ?? false)

  if (args.project !== undefined) {
    const id = resolveProjectId(projects, args.project)
    if (!id) {
      const known = projects.map((p) => `  ${p.name ?? ""} ${p.worktree}`).join("\n")
      fail(
        `no project matching "${args.project}"\n` +
          (known ? `Known projects:\n${known}\n` : ""),
      )
    }
    roots = filterProject(roots, id)
  }

  const totals = emptyUsage()
  for (const r of roots) {
    totals.input += r.usage.input
    totals.output += r.usage.output
    totals.reasoning += r.usage.reasoning
    totals.cacheRead += r.usage.cacheRead
    totals.cacheWrite += r.usage.cacheWrite
    totals.cost += r.usage.cost
  }

  if (roots.length === 0) {
    console.log(`opusage: no sessions found (${windowLabel(args, since)}${args.project ? ` in ${args.project}` : ""})`)
    return
  }

  const header = `opusage · ${windowLabel(args, since)} · ${roots.length} session${roots.length === 1 ? "" : "s"} · ${shortPath(dbPath)}`
  const tokenCols = (u: Usage): string[] => [human(u.input), human(u.output), human(u.reasoning), human(u.cacheRead + u.cacheWrite), pct(cacheHitRate(u))]

  if (args.format === "json") {
    const rows = groupRowsFor(args, roots, projects)
    const out = {
      tool: "opusage",
      version: VERSION,
      generatedAt: new Date().toISOString(),
      db: dbPath,
      window: since === null ? null : { since, match: args.active ? "updated" : "created" },
      project: args.project ?? null,
      view: args.models ? "models" : args.sessions ? "sessions" : "projects",
      sessions: roots.length,
      totals: { ...totals, totalTokens: totalTokens(totals) },
      rows: rows.map((r) => ({ ...r, totalTokens: totalTokens(r.usage) })),
    }
    console.log(JSON.stringify(out, null, 2))
    return
  }

  if (args.format === "csv") {
    const headers = ["label", "sessions", "input", "output", "reasoning", "cache_read", "cache_write", "cache_hit", "cost", "total"]
    const rows = groupRowsFor(args, roots, projects).map((r) => [
      r.label,
      r.sessions,
      r.usage.input,
      r.usage.output,
      r.usage.reasoning,
      r.usage.cacheRead,
      r.usage.cacheWrite,
      cacheHitRate(r.usage),
      r.usage.cost.toFixed(6),
      totalTokens(r.usage),
    ])
    // Context line goes to stderr so stdout is machine-parseable CSV.
    console.error(header)
    console.log(csv(headers, rows))
    return
  }

  // table format
  console.log(header)
  if (args.models || args.sessions) {
    const firstCol = args.models ? "model" : "session"
    const rows = groupRowsFor(args, roots, projects)
    const lines = rows.map((r) => [
      // clean() strips terminal escapes from LLM-generated labels (see render.ts)
      args.sessions ? clip(clean(r.label), 32) : clean(r.label),
      String(r.sessions),
      ...tokenCols(r.usage),
      money(r.usage.cost),
      human(totalTokens(r.usage)),
    ])
    if (args.sessions) {
      const subs = rows.filter((r) => r.sessions > 1).length
      if (subs > 0) {
        lines.push([])
        lines.push([`${subs} of ${rows.length} session${rows.length === 1 ? "" : "s"} include sub-agent usage`, "", ...tokenCols(totals), money(totals.cost), human(totalTokens(totals))])
      }
    }
    lines.push([])
    lines.push(["total", String(roots.length), ...tokenCols(totals), money(totals.cost), human(totalTokens(totals))])
    console.log(table([firstCol, "sessions", "in", "out", "rsn", "cache", "hit", "cost", "total"], lines))
  } else {
    const lines = byProject(roots, projects).map((r) => [
      clip(clean(r.label), 28),
      String(r.sessions),
      ...tokenCols(r.usage),
      money(r.usage.cost),
      human(totalTokens(r.usage)),
    ])
    lines.push([])
    lines.push(["total", String(roots.length), ...tokenCols(totals), money(totals.cost), human(totalTokens(totals))])
    console.log(table(["project", "sessions", "in", "out", "rsn", "cache", "hit", "cost", "total"], lines))
  }
}

function groupRowsFor(args: Args, roots: RootSession[], projects: ReturnType<typeof loadProjects>): GroupRow[] {
  if (args.models) return byModel(roots)
  if (args.sessions) return sessionRows(roots, projects, args.top === 0 ? roots.length : args.top)
  return byProject(roots, projects)
}

function shortPath(p: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
  if (!home) return p
  // Windows paths are case-insensitive; other platforms are not.
  const ci = process.platform === "win32"
  const a = ci ? home.toLowerCase() : home
  const b = ci ? p.toLowerCase() : p
  return b.startsWith(a) ? "~" + p.slice(home.length) : p
}
