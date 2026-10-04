import { DatabaseSync } from "node:sqlite"
import { existsSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { ProjectRow, SessionRow } from "./types.ts"

const DB_FILE = "opencode.db"

export function fail(message: string): never {
  console.error(`opusage: ${message}`)
  process.exit(1)
}

/** Candidate database locations, in priority order. */
function candidates(): string[] {
  const home = os.homedir()
  const out: string[] = []
  if (process.env.OPENCODE_DB) out.push(path.resolve(process.env.OPENCODE_DB))
  if (process.env.XDG_DATA_HOME) out.push(path.join(process.env.XDG_DATA_HOME, "opencode", DB_FILE))
  out.push(path.join(home, ".local", "share", "opencode", DB_FILE))
  if (process.platform === "win32" && process.env.APPDATA) {
    out.push(path.join(process.env.APPDATA, "opencode", DB_FILE))
  }
  return out
}

export function findDbPath(explicit?: string): string {
  if (explicit) {
    const p = path.resolve(explicit)
    if (!existsSync(p) || !statSync(p).isFile()) fail(`database not found: ${p}`)
    return p
  }
  for (const p of candidates()) {
    try {
      if (existsSync(p) && statSync(p).isFile()) return p
    } catch {
      // unreadable entry — skip
    }
  }
  fail(
    "OpenCode database not found.\n" +
      "  Run OpenCode at least once, or pass the path explicitly:\n" +
      "    opusage --db <path>\n" +
      "  OpenCode's canonical location: `opencode debug paths db`",
  )
}

/**
 * Open the database. We open it in normal (read-write) mode because a
 * read-only connection cannot recover a write-ahead log, but opusage
 * never issues a write.
 */
export function openDb(dbPath: string): DatabaseSync {
  try {
    return new DatabaseSync(dbPath)
  } catch (e) {
    fail(
      `could not open ${dbPath}: ${(e as Error).message}\n` +
        "  If OpenCode uses a custom data directory, pass it with --db " +
        "(canonical location: `opencode debug paths db`)",
    )
  }
}

const SESSION_COLUMNS = [
  "id",
  "project_id",
  "parent_id",
  "title",
  "agent",
  "model",
  "cost",
  "tokens_input",
  "tokens_output",
  "tokens_reasoning",
  "tokens_cache_read",
  "tokens_cache_write",
  "time_created",
  "time_updated",
] as const

export function loadSessions(db: DatabaseSync): SessionRow[] {
  const info = db.prepare("PRAGMA table_info(session_v2)").all() as Array<{ name: string }>
  const cols = new Set(info.map((r) => r.name))
  const missing = SESSION_COLUMNS.filter((c) => !cols.has(c))
  if (missing.length > 0) {
    fail(
      `OpenCode's database schema does not match (session_v2 is missing: ${missing.join(", ")}).\n` +
        "  This version of opusage was built for OpenCode v2.0.x. Check for a newer opusage release,\n" +
        "  or file an issue at the repository with your `opencode --version` output.",
    )
  }
  return db.prepare(`SELECT ${SESSION_COLUMNS.join(", ")} FROM session_v2`).all() as unknown as SessionRow[]
}

export function loadProjects(db: DatabaseSync): ProjectRow[] {
  const info = db.prepare("PRAGMA table_info(project)").all() as Array<{ name: string }>
  if (info.length === 0 || !info.some((r) => r.name === "worktree")) return []
  try {
    return db.prepare("SELECT id, worktree, name FROM project").all() as unknown as ProjectRow[]
  } catch {
    return []
  }
}
