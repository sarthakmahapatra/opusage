import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"
import { expectFail, seedProject, seedStandard, tempDb, withEnv } from "./util.ts"
import { findDbPath, loadProjects, loadSessions, openDb } from "../src/db.ts"

test("findDbPath: explicit path that exists", () => {
  const t = tempDb()
  try {
    assert.equal(findDbPath(t.path), t.path)
  } finally {
    t.close()
  }
})

test("findDbPath: explicit path that is missing exits 1 with a message", () => {
  const missing = path.join(os.tmpdir(), `opusage-nope-${Date.now()}.db`)
  const { code, stderr } = expectFail(() => findDbPath(missing))
  assert.equal(code, 1)
  assert.match(stderr, /database not found/)
})

test("findDbPath: explicit path pointing at a directory is rejected", () => {
  const { code, stderr } = expectFail(() => findDbPath(os.tmpdir()))
  assert.equal(code, 1)
  assert.match(stderr, /database not found/)
})

/** A scratch directory containing `opencode.db` (and closed), for env-var layout tests. */
function scratchDb(subpath: string): { dir: string; db: string; close: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "opusage-env-"))
  const p = path.join(dir, subpath)
  mkdirSync(path.dirname(p), { recursive: true })
  new DatabaseSync(p).close()
  return { dir, db: p, close: () => rmSync(dir, { recursive: true, force: true }) }
}

test("findDbPath: OPENCODE_DB env var wins", () => {
  const s = scratchDb("opencode.db")
  try {
    withEnv({ OPENCODE_DB: s.db, XDG_DATA_HOME: undefined, HOME: os.tmpdir() }, () => {
      assert.equal(findDbPath(), s.db)
    })
  } finally {
    s.close()
  }
})

test("findDbPath: $XDG_DATA_HOME/opencode layout", () => {
  const s = scratchDb("opencode/opencode.db")
  try {
    withEnv({ OPENCODE_DB: undefined, XDG_DATA_HOME: s.dir, HOME: path.join(s.dir, "nohome") }, () => {
      assert.equal(findDbPath(), s.db)
    })
  } finally {
    s.close()
  }
})

test("findDbPath: $HOME/.local/share/opencode layout", () => {
  const s = scratchDb(".local/share/opencode/opencode.db")
  try {
    withEnv({ OPENCODE_DB: undefined, XDG_DATA_HOME: undefined, HOME: s.dir }, () => {
      assert.equal(findDbPath(), s.db)
    })
  } finally {
    s.close()
  }
})

test("findDbPath: nothing anywhere exits 1 with guidance", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "opusage-empty-"))
  try {
    const { code, stderr } = expectFail(() =>
      withEnv({ OPENCODE_DB: undefined, XDG_DATA_HOME: undefined, HOME: dir }, () => findDbPath()),
    )
    assert.equal(code, 1)
    assert.match(stderr, /OpenCode database not found/)
    assert.match(stderr, /opencode debug paths db/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("openDb: a real database opens", () => {
  const t = tempDb()
  try {
    const db = openDb(t.path)
    db.close()
  } finally {
    t.close()
  }
})

test("openDb: a corrupt file exits 1 with a helpful message", () => {
  const t = tempDb()
  t.close() // removes the dir; recreate just the file as garbage
  mkdirSync(path.dirname(t.path), { recursive: true })
  writeFileSync(t.path, "this is not a sqlite database, just garbage bytes")
  try {
    const { code, stderr } = expectFail(() => openDb(t.path))
    assert.equal(code, 1)
    assert.match(stderr, /could not read/)
    assert.match(stderr, /file is not a database/)
  } finally {
    rmSync(path.dirname(t.path), { recursive: true, force: true })
  }
})

test("loadSessions: returns rows with the expected values", () => {
  const t = tempDb()
  try {
    seedStandard(t.db, 1_700_000_000_000)
    const rows = loadSessions(t.db)
    assert.equal(rows.length, 7)
    const s1 = rows.find((r) => r.id === "s1")!
    assert.equal(s1.tokens_input, 1_500_000)
    assert.equal(s1.model, '{"id":"gpt-5","providerID":"openai"}')
    assert.equal(s1.parent_id, null)
    assert.equal(rows.find((r) => r.id === "s2")!.parent_id, "s1")
  } finally {
    t.close()
  }
})

test("loadSessions: a schema missing expected columns fails loudly", () => {
  const t = tempDb()
  try {
    t.db.exec("DROP TABLE session_v2")
    t.db.exec(
      `CREATE TABLE session_v2 (
         id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, title TEXT, agent TEXT,
         model TEXT, cost REAL,
         tokens_input INTEGER, tokens_output INTEGER,
         tokens_cache_read INTEGER, tokens_cache_write INTEGER,
         time_created INTEGER, time_updated INTEGER
       )`,
    )
    const { code, stderr } = expectFail(() => loadSessions(t.db))
    assert.equal(code, 1)
    assert.match(stderr, /does not match/)
    assert.match(stderr, /tokens_reasoning/)
  } finally {
    t.close()
  }
})

test("loadSessions: a database without session_v2 at all fails with the full column list", () => {
  const t = tempDb()
  try {
    t.db.exec("DROP TABLE session_v2")
    const { code, stderr } = expectFail(() => loadSessions(t.db))
    assert.equal(code, 1)
    assert.match(stderr, /session_v2/)
    assert.match(stderr, /tokens_input/)
  } finally {
    t.close()
  }
})

test("loadProjects: no project table -> empty", () => {
  const t = tempDb()
  try {
    t.db.exec("DROP TABLE project")
    assert.deepEqual(loadProjects(t.db), [])
  } finally {
    t.close()
  }
})

test("loadProjects: a table without the worktree column -> empty", () => {
  const t = tempDb()
  try {
    t.db.exec("DROP TABLE project")
    t.db.exec(`CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT)`)
    t.db.prepare(`INSERT INTO project (id, name) VALUES ('p1','alpha')`).run()
    assert.deepEqual(loadProjects(t.db), [])
  } finally {
    t.close()
  }
})

test("loadProjects: returns id, worktree, name", () => {
  const t = tempDb()
  try {
    seedProject(t.db, { id: "p1", worktree: "/x/alpha", name: "alpha" })
    seedProject(t.db, { id: "p2", worktree: "/x/beta", name: null })
    const rows = loadProjects(t.db)
    assert.equal(rows.length, 2)
    assert.deepEqual(rows[0], { id: "p1", worktree: "/x/alpha", name: "alpha" })
    assert.equal(rows[1].name, null)
  } finally {
    t.close()
  }
})
