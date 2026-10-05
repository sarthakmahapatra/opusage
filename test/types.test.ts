import assert from "node:assert/strict"
import { test } from "node:test"
import { addSession, cacheHitRate, emptyUsage, totalTokens, type Usage } from "../src/types.ts"

test("emptyUsage is all zeros", () => {
  assert.deepEqual(emptyUsage(), { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 })
})

test("totalTokens sums every counter", () => {
  const u: Usage = { input: 100, output: 200, reasoning: 300, cacheRead: 400, cacheWrite: 500, cost: 1 }
  assert.equal(totalTokens(u), 1_500)
  assert.equal(totalTokens(emptyUsage()), 0)
})

test("cacheHitRate guards the zero denominator", () => {
  assert.equal(cacheHitRate(emptyUsage()), 0)
})

test("cacheHitRate = cacheRead / (input + cacheRead)", () => {
  const u: Usage = { input: 1_000, output: 0, reasoning: 0, cacheRead: 3_000, cacheWrite: 999, cost: 0 }
  // output, reasoning, and writes are not part of the denominator
  assert.ok(Math.abs(cacheHitRate(u) - 0.75) < 1e-12)
})

test("addSession accumulates into the given Usage", () => {
  const u = emptyUsage()
  addSession(u, { tokens_input: 1, tokens_output: 2, tokens_reasoning: 3, tokens_cache_read: 4, tokens_cache_write: 5, cost: 0.5 })
  addSession(u, { tokens_input: 10, tokens_output: 20, tokens_reasoning: 30, tokens_cache_read: 40, tokens_cache_write: 50, cost: 1.5 })
  assert.equal(u.input, 11)
  assert.equal(u.output, 22)
  assert.equal(u.reasoning, 33)
  assert.equal(u.cacheRead, 44)
  assert.equal(u.cacheWrite, 55)
  assert.ok(Math.abs(u.cost - 2) < 1e-9)
})
