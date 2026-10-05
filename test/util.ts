/** Test helpers shared across the suite. */
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { ProjectRow, SessionRow } from "../src/types.ts"

/** Thrown in place of process.exit so fail() is assertable. */
export class ExitError extends Error {
  code: number
  constructor(code: number) {
    super(`exit:${code}`)
    this.code = code
  }
}

/**
 * Run `fn`, expecting it to call fail()/process.exit. Returns the exit code
 * and whatever was written to stderr. Restores process.exit and console.error.
 */
export function expectFail(fn: () => void): { code: number; stderr: string } {
  const origExit = process.exit
  const origErr = console.error
  const errs: string[] = []
  const state = { code: 1 }
  process.exit = ((c?: number | string) => {
    state.code = Number(c) ?? 1
    throw new ExitError(state.code)
  }) as never
  console.error = (...a: unknown[]) => {
    errs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "))
  }
  try {
    fn()
  } catch (e) {
    if (e instanceof ExitError) return { code: state.code, stderr: errs.join("\n") }
    throw e
  } finally {
    process.exit = origExit
    console.error = origErr
  }
  throw new Error("expected fail() to call process.exit, but the call returned normally")
}

/** Run `fn` with `vars` applied to process.env, restoring everything after. */
export function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved = new Map<string, string | undefined>()
  for (const [k, v] of Object.entries(vars)) {
    saved.set(k, process.env[k])
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    fn()
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

/** A throwaway on-disk SQLite database with OpenCode's (reduced) schema. */
export interface TempDb {
  dir: string
  path: string
  db: DatabaseSync
  close: () => void
}

export function tempDb(): TempDb {
  const dir = mkdtempSync(path.join(os.tmpdir(), "opusage-test-"))
  const p = path.join(dir, "opencode.db")
  const db = new DatabaseSync(p)
  db.exec(
    `CREATE TABLE session_v2 (
       id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, title TEXT, agent TEXT,
       model TEXT, cost REAL,
       tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER,
       tokens_cache_read INTEGER, tokens_cache_write INTEGER,
       time_created INTEGER, time_updated INTEGER
     )`,
  )
  db.exec(`CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT, name TEXT)`)
  return {
    dir,
    path: p,
    db,
    close: () => {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

export function seedSession(db: DatabaseSync, s: Partial<SessionRow> & { id: string }): void {
  db.prepare(
    `INSERT INTO session_v2 (id, project_id, parent_id, title, agent, model, cost,
       tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
       time_created, time_updated)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    s.id,
    s.project_id ?? "p1",
    s.parent_id ?? null,
    s.title ?? null,
    s.agent ?? null,
    s.model ?? null,
    s.cost ?? 0,
    s.tokens_input ?? 0,
    s.tokens_output ?? 0,
    s.tokens_reasoning ?? 0,
    s.tokens_cache_read ?? 0,
    s.tokens_cache_write ?? 0,
    s.time_created ?? 0,
    s.time_updated ?? 0,
  )
}

export function seedProject(db: DatabaseSync, p: ProjectRow): void {
  db.prepare(`INSERT INTO project (id, worktree, name) VALUES (?,?,?)`).run(p.id, p.worktree, p.name ?? null)
}

/** A SessionRow with sane defaults; override what a test cares about. */
export function row(partial: Partial<SessionRow> & { id: string }): SessionRow {
  return {
    project_id: "p1",
    parent_id: null,
    title: null,
    agent: null,
    model: null,
    cost: 0,
    tokens_input: 0,
    tokens_output: 0,
    tokens_reasoning: 0,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    time_created: 1_000_000,
    time_updated: 1_000_000,
    ...partial,
  }
}

/**
 * Standard fixture (shared by db + cli tests): 2 projects, 7 sessions.
 *
 *   s1  p1  root,  2d old, active 1h ago   1.5M in / 10k out / 5k rsn / 50k cr / $1.23
 *   s2  p1  child of s1                     100k in / 2k out / $0.10
 *   s3  p1  grandchild of s2                20k in / $0.02
 *   s4  p2  root, 3d old, active 1h ago     999,600 in / 1k out   (the 1M boundary)
 *   s5  p2  root, exactly 1d old            1.5k in / 100 out / $0.50
 *   s6  p2  malformed: s6 <-> s7 cycle      10 in
 *   s7  p2  malformed: s6 <-> s7 cycle      20 in
 *
 * Family (s1+s2+s3): in 1,620,000 · out 12,000 · rsn 5,000 · cr 50,000 · $1.35
 */
const DAY = 86_400_000
const HOUR = 3_600_000

export function seedStandard(db: DatabaseSync, now = Date.now()): void {
  seedProject(db, { id: "p1", worktree: "/home/u/alpha", name: "alpha" })
  seedProject(db, { id: "p2", worktree: "/home/u/beta", name: "beta" })

  seedSession(db, {
    id: "s1", project_id: "p1", title: "Alpha build",
    model: '{"id":"gpt-5","providerID":"openai"}', cost: 1.23,
    tokens_input: 1_500_000, tokens_output: 10_000, tokens_reasoning: 5_000, tokens_cache_read: 50_000,
    time_created: now - 2 * DAY, time_updated: now - HOUR,
  })
  seedSession(db, {
    id: "s2", project_id: "p1", parent_id: "s1", title: "Alpha sub",
    model: '{"id":"gpt-5","providerID":"openai"}', cost: 0.1,
    tokens_input: 100_000, tokens_output: 2_000,
    time_created: now - 2 * DAY + 60_000, time_updated: now - HOUR / 2,
  })
  seedSession(db, {
    id: "s3", project_id: "p1", parent_id: "s2",
    model: '{"id":"gpt-5","providerID":"openai"}', cost: 0.02,
    tokens_input: 20_000,
    time_created: now - 2 * DAY + 120_000, time_updated: now - HOUR / 3,
  })
  seedSession(db, {
    id: "s4", project_id: "p2", title: "Comma, title",
    tokens_input: 999_600, tokens_output: 1_000,
    time_created: now - 3 * DAY, time_updated: now - HOUR,
  })
  // s5/s6/s7 are created safely INSIDE a 1-day window (boundary semantics are
  // covered exactly in the aggregate unit tests; the E2E window tests must not
  // flake on millisecond drift between fixture creation and the run).
  seedSession(db, {
    id: "s5", project_id: "p2", title: "Fresh", cost: 0.5,
    tokens_input: 1_500, tokens_output: 100,
    time_created: now - DAY + 5_000, time_updated: now - 60_000,
  })
  seedSession(db, { id: "s6", project_id: "p2", parent_id: "s7", title: "cycA", tokens_input: 10, time_created: now - 2 * HOUR, time_updated: now })
  seedSession(db, { id: "s7", project_id: "p2", parent_id: "s6", title: "cycB", tokens_input: 20, time_created: now - 2 * HOUR, time_updated: now })
}
