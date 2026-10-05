import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { test } from "node:test"
import { seedStandard, seedSession, seedProject, tempDb } from "./util.ts"
import { main } from "../src/index.ts"

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const BIN = path.join(REPO, "bin", "opusage.js")

/** Spawn the real CLI and capture stdout/stderr/exit code. */
function run(args: string[], opts: { env?: Record<string, string> } = {}): { code: number; out: string; err: string } {
  try {
    const out = execFileSync(process.execPath, [BIN, ...args], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { code: 0, out, err: "" }
  } catch (e) {
    const err = (e as { stderr?: Buffer | string }).stderr
    return {
      code: (e as { code?: number }).code ?? 1,
      out: (e as { stdout?: Buffer | string }).stdout?.toString() ?? "",
      err: typeof err === "string" ? err : err?.toString() ?? "",
    }
  }
}

/** Run main() in-process (imports the real entry, no subprocess). */
function runMain(args: string[]): { code: number; out: string; err: string } {
  let out = ""
  let err = ""
  const origLog = console.log
  const origErr = console.error
  const origExit = process.exit
  console.log = (...a: unknown[]) => (out += a.join(" ") + "\n")
  console.error = (...a: unknown[]) => (err += a.join(" ") + "\n")
  process.exit = ((c?: number | string) => {
    throw new (class extends Error {
      code = Number(c) ?? 1
    })()
  }) as never
  try {
    main(args)
  } catch (e) {
    return { code: (e as { code?: number }).code ?? 1, out, err }
  } finally {
    console.log = origLog
    console.error = origErr
    process.exit = origExit
  }
  return { code: 0, out, err }
}

// ---------------------------------------------------------------------------
// Argument parsing (in-process — fast, no subprocess)
// ---------------------------------------------------------------------------

test("parse: --version prints the version and exits 0", () => {
  const r = run(["--version"])
  assert.equal(r.code, 0)
  assert.match(r.out, /opusage|0\./)
})

test("parse: --help exits 0 and shows usage", () => {
  const r = run(["--help"])
  assert.equal(r.code, 0)
  assert.match(r.out, /Usage:/)
  assert.match(r.out, /--days/)
})

test("parse: unknown argument exits 1", () => {
  const r = run(["--definitely-not-a-flag"])
  assert.equal(r.code, 1)
  assert.match(r.err, /unknown argument/)
})

test("parse: --models and --sessions are mutually exclusive", () => {
  const r = run(["--models", "--sessions"])
  assert.equal(r.code, 1)
  assert.match(r.err, /mutually exclusive/)
})

test("parse: non-numeric --days is rejected", () => {
  const r = run(["--days", "soon"])
  assert.equal(r.code, 1)
  assert.match(r.err, /--days/)
})

test("parse: invalid --format is rejected", () => {
  const r = run(["--format", "yaml"])
  assert.equal(r.code, 1)
  assert.match(r.err, /--format/)
})

test("parse: a --db that does not exist exits 1", () => {
  const r = run(["--db", "/no/such/file.db"])
  assert.equal(r.code, 1)
  assert.match(r.err, /database not found/)
})

// ---------------------------------------------------------------------------
// End-to-end against a fixture database
// ---------------------------------------------------------------------------

function fixtureDb() {
  const t = tempDb()
  seedStandard(t.db) // also seeds the two projects
  return t
}

test("e2e: default project view reports families without double counting", () => {
  const t = fixtureDb()
  try {
    const r = run(["--db", t.path])
    assert.equal(r.code, 0)
    // alpha = one root (s1 family of 3) ; beta = 4 roots (s4,s5,s6,s7)
    assert.match(r.out, /alpha/)
    assert.match(r.out, /beta/)
    // The alpha row must show the rolled-up family input, not the root alone.
    // family input = 1,500,000 + 100,000 + 20,000 = 1,620,000 -> "1.6M"
    const alphaLine = r.out.split("\n").find((l) => l.includes("alpha"))!
    assert.match(alphaLine, /1\.6M/)
    // sub-agent sessions appear in the "sessions" column for alpha
    assert.match(alphaLine, /3/)
  } finally {
    t.close()
  }
})

test("e2e: --sessions lists sessions sorted by total, sliced to top N", () => {
  const t = fixtureDb()
  try {
    const r = run(["--db", t.path, "--sessions", "3"])
    assert.equal(r.code, 0)
    // Top 3 by total tokens: s1 family, s4, s5 — the cycle pair is cut.
    assert.match(r.out, /Alpha build/)
    assert.match(r.out, /Comma, title/)
    assert.match(r.out, /Fresh/)
    assert.doesNotMatch(r.out, /cycA/)
  } finally {
    t.close()
  }
})

test("e2e: --models groups by model label", () => {
  const t = fixtureDb()
  try {
    const r = run(["--db", t.path, "--models"])
    assert.equal(r.code, 0)
    assert.match(r.out, /openai\/gpt-5/)
    assert.match(r.out, /unknown/)
  } finally {
    t.close()
  }
})

test("e2e: --project filters by name", () => {
  const t = fixtureDb()
  try {
    const r = run(["--db", t.path, "--project", "alpha"])
    assert.equal(r.code, 0)
    assert.match(r.out, /alpha/)
    assert.doesNotMatch(r.out, /beta/)
  } finally {
    t.close()
  }
})

test("e2e: --project with no match exits 1 and lists known projects", () => {
  const t = fixtureDb()
  try {
    const r = run(["--db", t.path, "--project", "does-not-exist"])
    assert.equal(r.code, 1)
    assert.match(r.err, /no project matching/)
    assert.match(r.err, /alpha/)
  } finally {
    t.close()
  }
})

test("e2e: --format json emits valid, complete JSON", () => {
  const t = fixtureDb()
  try {
    const r = run(["--db", t.path, "--format", "json"])
    assert.equal(r.code, 0)
    const doc = JSON.parse(r.out)
    assert.equal(doc.tool, "opusage")
    assert.equal(doc.view, "projects")
    assert.equal(doc.sessions, 5) // 7 raw sessions roll up to 5 roots (s1 family = 1)
    assert.ok(doc.totals.input > 0)
    assert.ok(Array.isArray(doc.rows))
    assert.equal(doc.rows.length, 2) // alpha + beta
    // alpha row: 1 root (family rolled up)
    const alpha = doc.rows.find((x: { label: string }) => x.label === "alpha")
    assert.equal(alpha.sessions, 1)
    assert.equal(alpha.usage.input, 1_620_000)
  } finally {
    t.close()
  }
})

test("e2e: --format csv is parseable and quotes a comma title", () => {
  const t = fixtureDb()
  try {
    // "Comma, title" must come out quoted
    const r = run(["--db", t.path, "--sessions", "10", "--format", "csv"])
    assert.equal(r.code, 0)
    assert.match(r.out, /"Comma, title"/)
    // header row present
    assert.match(r.out, /label,sessions,input/)
  } finally {
    t.close()
  }
})

test("e2e: a title with terminal escapes is sanitized in table output", () => {
  const t = tempDb()
  try {
    seedProject(t.db, { id: "p1", worktree: "/home/u/alpha", name: "alpha" })
    seedSession(t.db, {
      id: "s1",
      project_id: "p1",
      title: "\u001b[31mRED\u001b[0m normal",
      tokens_input: 5_000,
    })
    const r = run(["--db", t.path, "--sessions", "5"])
    assert.equal(r.code, 0)
    assert.doesNotMatch(r.out, /\u001b/)
    assert.match(r.out, /RED normal/)
  } finally {
    t.close()
  }
})

test("e2e: an empty window prints a friendly message, exit 0", () => {
  const t = fixtureDb()
  try {
    // a window in the far future: nothing matches
    const r = run(["--db", t.path, "--since", "2999-01-01"])
    assert.equal(r.code, 0)
    assert.match(r.out, /no sessions found/)
  } finally {
    t.close()
  }
})

test("e2e: --since with --active matches on last activity, not creation", () => {
  const t = tempDb()
  try {
    seedProject(t.db, { id: "p1", worktree: "/home/u/alpha", name: "alpha" })
    const now = Date.now()
    const day = 86_400_000
    // created long ago (outside window) but updated recently (inside window)
    seedSession(t.db, {
      id: "s1",
      project_id: "p1",
      title: "Old but active",
      tokens_input: 1_000,
      time_created: now - 10 * day,
      time_updated: now - day / 2,
    })
    // a 1-day window
    const r = run(["--db", t.path, "--days", "1", "--active", "--format", "json"])
    const doc = JSON.parse(r.out)
    assert.equal(doc.sessions, 1) // matched by updated time

    // Created 10 days ago: the plain (created) view finds nothing. An empty
    // result prints a friendly line instead of a JSON document.
    const r2 = run(["--db", t.path, "--days", "1", "--format", "json"])
    assert.match(r2.out, /no sessions found/)
  } finally {
    t.close()
  }
})

test("e2e: OPENCODE_DB env var is honored when --db is absent", () => {
  const t = fixtureDb()
  try {
    const r = run(["--format", "json"], { env: { OPENCODE_DB: t.path } })
    assert.equal(r.code, 0)
    const doc = JSON.parse(r.out)
    assert.equal(doc.sessions, 5)
  } finally {
    t.close()
  }
})

test("in-process main(): a bad db path fails cleanly", () => {
  const r = runMain(["--db", "/definitely/missing.db"])
  assert.equal(r.code, 1)
  assert.match(r.err, /database not found/)
})
