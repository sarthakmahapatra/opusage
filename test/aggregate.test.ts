import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import {
  byModel,
  byProject,
  filterProject,
  filterWindow,
  modelLabel,
  parseModel,
  resolveProjectId,
  rollupFamilies,
  sessionRows,
} from "../src/aggregate.ts"
import { row } from "./util.ts"
import type { ProjectRow, SessionRow } from "../src/types.ts"

test("parseModel: null, invalid JSON, and incomplete objects", () => {
  assert.equal(parseModel(null), null)
  assert.equal(parseModel("not json {"), null)
  assert.equal(parseModel('{"id":"x"}'), null) // missing providerID
  assert.equal(parseModel('{"providerID":"p"}'), null) // missing id
  assert.deepEqual(parseModel('{"id":"x","providerID":"p"}'), { id: "x", providerID: "p", variant: undefined })
  assert.deepEqual(parseModel('{"id":"x","providerID":"p","variant":"fast"}'), { id: "x", providerID: "p", variant: "fast" })
})

test("modelLabel: unknown, plain, variant", () => {
  assert.equal(modelLabel(null), "unknown")
  assert.equal(modelLabel({ id: "gpt-5", providerID: "openai" }), "openai/gpt-5")
  assert.equal(modelLabel({ id: "gpt-5", providerID: "openai", variant: "fast" }), "openai/gpt-5#fast")
})

test("rollupFamilies: empty input", () => {
  assert.deepEqual(rollupFamilies([]), [])
})

test("rollupFamilies: a lone root keeps its own counters", () => {
  const [r] = rollupFamilies([row({ id: "s1", tokens_input: 5, cost: 0.25 })])
  assert.equal(r.id, "s1")
  assert.equal(r.members, 1)
  assert.equal(r.usage.input, 5)
  assert.equal(r.usage.cost, 0.25)
})

test("rollupFamilies: root + child + grandchild collapse into one", () => {
  const rows = [
    row({ id: "s1", tokens_input: 100, time_created: 100, time_updated: 1000 }),
    row({ id: "s2", parent_id: "s1", tokens_output: 200, time_created: 200, time_updated: 5000 }),
    row({ id: "s3", parent_id: "s2", tokens_reasoning: 300, time_created: 300, time_updated: 3000 }),
  ]
  const roots = rollupFamilies(rows)
  assert.equal(roots.length, 1)
  const r = roots[0]
  assert.equal(r.id, "s1")
  assert.equal(r.members, 3)
  assert.equal(r.usage.input, 100)
  assert.equal(r.usage.output, 200)
  assert.equal(r.usage.reasoning, 300)
  assert.equal(r.time_updated, 5000) // max across the family
})

test("rollupFamilies: a child of a missing parent becomes its own root", () => {
  const [r] = rollupFamilies([row({ id: "s2", parent_id: "missing", title: "orphan" })])
  assert.equal(r.id, "s2")
  assert.equal(r.title, "orphan")
})

test("rollupFamilies: a malformed cycle cannot loop forever or double-count", () => {
  const roots = rollupFamilies([
    row({ id: "s6", parent_id: "s7", tokens_input: 10 }),
    row({ id: "s7", parent_id: "s6", tokens_input: 20 }),
  ])
  // Each cycle member resolves to itself: two roots, one member each.
  assert.equal(roots.length, 2)
  const totalInput = roots.reduce((a, r) => a + r.usage.input, 0)
  const totalMembers = roots.reduce((a, r) => a + r.members, 0)
  assert.equal(totalInput, 30) // no double counting
  assert.equal(totalMembers, 2)
})

test("filterWindow: null is a no-op, created vs active, boundary inclusive", () => {
  const [a, b] = rollupFamilies([
    row({ id: "a", time_created: 1000, time_updated: 9000 }),
    row({ id: "b", time_created: 9000, time_updated: 1000 }),
  ])
  assert.equal(filterWindow([a, b], null, false).length, 2)
  // created >= since
  assert.deepEqual(
    filterWindow([a, b], 9000, false).map((r) => r.id),
    ["b"],
  )
  // active (updated) >= since
  assert.deepEqual(
    filterWindow([a, b], 9000, true).map((r) => r.id),
    ["a"],
  )
})

test("filterProject: exact project id", () => {
  const [a, b] = rollupFamilies([
    row({ id: "a", project_id: "p1" }),
    row({ id: "b", project_id: "p2" }),
  ])
  assert.deepEqual(filterProject([a, b], "p2").map((r) => r.id), ["b"])
})

test("resolveProjectId: id, name (case-insensitive), worktree substring, miss", () => {
  const projects: ProjectRow[] = [
    { id: "p1", worktree: "/home/u/alpha", name: "Alpha" },
    { id: "p2", worktree: "/home/u/beta", name: null },
  ]
  assert.equal(resolveProjectId(projects, "p2"), "p2")
  assert.equal(resolveProjectId(projects, "alpha"), "p1") // name, case-insensitive
  assert.equal(resolveProjectId(projects, "beta"), "p2") // name match
  assert.equal(resolveProjectId(projects, "/home/u/alpha"), "p1") // path
  assert.equal(resolveProjectId(projects, "nope"), null)
})

test("resolveProjectId: '.' picks the deepest worktree containing cwd", () => {
  // realpath: on macOS $TMPDIR is a symlink (/var -> /private/var), and
  // process.cwd() reports the resolved form.
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "opusage-cwd-")))
  const proj = path.join(base, "proj")
  const nested = path.join(proj, "nested")
  mkdirSync(nested, { recursive: true })
  const projects: ProjectRow[] = [
    { id: "p1", worktree: proj, name: null },
    { id: "p2", worktree: nested, name: null },
  ]
  const prev = process.cwd()
  try {
    process.chdir(nested)
    assert.equal(resolveProjectId(projects, "."), "p2") // deepest wins
    process.chdir(proj)
    assert.equal(resolveProjectId(projects, "."), "p1")
    process.chdir(base)
    assert.equal(resolveProjectId(projects, "."), null) // outside all
  } finally {
    process.chdir(prev)
    rmSync(base, { recursive: true, force: true })
  }
})

test("resolveProjectId: backslash worktrees match slash-free name specs", () => {
  // We cannot chdir to a Windows path on POSIX, so exercise the normalization
  // through the name/substring branches with a backslash worktree.
  const projects: ProjectRow[] = [{ id: "p1", worktree: "C:\\Users\\u\\proj", name: null }]
  assert.equal(resolveProjectId(projects, "proj"), "p1")
  assert.equal(resolveProjectId(projects, "users/u/proj"), "p1")
})

test("byProject: names, basename fallback, unknown ids, sorted by total desc", () => {
  const projects: ProjectRow[] = [
    { id: "p1", worktree: "/x/alpha", name: "alpha" },
    { id: "p2", worktree: "/x/beta", name: null }, // falls back to basename
  ]
  const roots = rollupFamilies([
    row({ id: "s1", project_id: "p1", tokens_input: 100 }),
    row({ id: "s2", project_id: "p2", tokens_input: 1000 }),
    row({ id: "s3", project_id: "ghost", tokens_input: 10 }),
  ])
  const rows = byProject(roots, projects)
  assert.deepEqual(
    rows.map((r) => [r.label, r.sessions]),
    [
      ["beta", 1], // 1000 tokens sorts first
      ["alpha", 1],
      ["ghost", 1], // unknown project id used as label
    ],
  )
  assert.equal(rows[0].sub, "/x/beta")
})

test("byModel: groups by model label, unknown bucket, sorted", () => {
  const roots = rollupFamilies([
    row({ id: "s1", model: '{"id":"gpt-5","providerID":"openai"}', tokens_input: 1000 }),
    row({ id: "s2", model: '{"id":"gpt-5","providerID":"openai"}', tokens_input: 100 }),
    row({ id: "s3", model: null, tokens_input: 500 }),
  ])
  const rows = byModel(roots)
  assert.deepEqual(
    rows.map((r) => [r.label, r.sessions]),
    [
      ["openai/gpt-5", 2],
      ["unknown", 1],
    ],
  )
})

test("sessionRows: sorted by total desc, sliced to top, title falls back to id", () => {
  const projects: ProjectRow[] = [{ id: "p1", worktree: "/x/alpha", name: "alpha" }]
  const roots = rollupFamilies([
    row({ id: "s1", title: "Big", tokens_input: 5000 }),
    row({ id: "s2", title: "Mid", tokens_input: 2000 }),
    row({ id: "s3", tokens_input: 1000 }), // no title -> id
  ])
  const rows = sessionRows(roots, projects, 2)
  assert.deepEqual(
    rows.map((r) => r.label),
    ["Big", "Mid"],
  )
  const all = sessionRows(roots, projects, 3)
  assert.equal(all[2].label, "s3")
  assert.match(all[0].sub ?? "", /alpha/) // project basename in the sub label
  assert.match(all[0].sub ?? "", /s1 ·/) // session id present too
})
