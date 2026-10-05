import assert from "node:assert/strict"
import { test } from "node:test"
import { clean, clip, csv, date, human, money, pct, table } from "../src/render.ts"

const ESC = "\u001b"
const BEL = "\u0007"

test("human: below 1k stays plain", () => {
  assert.equal(human(0), "0")
  assert.equal(human(999), "999")
  assert.equal(human(0.4), "0")
  assert.equal(human(-1), "-")
  assert.equal(human(NaN), "-")
  assert.equal(human(Infinity), "-")
})

test("human: k range", () => {
  assert.equal(human(1_000), "1k")
  assert.equal(human(1_234), "1.2k")
  assert.equal(human(9_994), "10k") // 9.994 rounds to 10
  assert.equal(human(150_000), "150k") // >= 100x drops the decimal
  assert.equal(human(999_400), "999k")
})

test("human: unit boundary promotion (the 999.6k bug)", () => {
  assert.equal(human(999_600), "1M") // not "1000k"
  assert.equal(human(1_000_000), "1M")
  assert.equal(human(1_234_567), "1.2M")
  assert.equal(human(999_600_000), "1b") // not "1000M"
  assert.equal(human(1_500_000_000), "1.5b")
  assert.equal(human(999_600_000_000), "1t") // not "1000b"
})

test("money: precision tiers and locale grouping", () => {
  assert.equal(money(0), "$0.00")
  assert.equal(money(1), "$1.00")
  assert.equal(money(1.234), "$1.23")
  assert.equal(money(0.999), "$0.999")
  assert.equal(money(0.0041), "$0.0041")
  assert.equal(money(1_234.5), "$1,234.50")
  assert.equal(money(NaN), "$0.00")
})

test("pct: rounds, guards zero and negatives", () => {
  assert.equal(pct(0), "-")
  assert.equal(pct(-0.2), "-")
  assert.equal(pct(0.183), "18%")
  assert.equal(pct(1), "100%")
  assert.equal(pct(0.5), "50%")
})

test("date: ISO calendar day from epoch ms", () => {
  assert.equal(date(new Date("2026-01-02T03:04:05Z").getTime()), "2026-01-02")
})

test("clip: elides the tail with an ellipsis", () => {
  assert.equal(clip("hi", 10), "hi")
  assert.equal(clip("0123456789", 10), "0123456789")
  assert.equal(clip("0123456789abcdefgh", 10), "01234567…")
  assert.equal(clip("0123456789abcdefgh", 3), "012") // too narrow for an ellipsis
})

test("table: left column left-aligned, rest right-aligned, two-space gap", () => {
  const out = table(
    ["project", "sessions", "in"],
    [
      ["a", "1", "123"],
      ["muchlonger", "2", "4"],
    ],
  )
  assert.equal(
    out,
    [
      "project     sessions  in ",
      "a                  1  123",
      "muchlonger         2    4",
    ].join("\n"),
  )
  // every line is the same width
  const widths = out.split("\n").map((l) => l.length)
  assert.ok(new Set(widths).size === 1)
})

test("csv: quotes commas, quotes, newlines and CR; doubles inner quotes", () => {
  const out = csv(["a", "b"], [
    ["plain", 1],
    ["b,2", "x"],
    ['x"y', "z"],
    ["a\nb", "w"],
    ["a\rb", "v"],
  ])
  assert.equal(
    out,
    ["a,b", "plain,1", '"b,2",x', '"x""y",z', '"a\nb",w', '"a\rb",v'].join("\n"),
  )
})

test("clean: strips ANSI CSI sequences", () => {
  assert.equal(clean(`${ESC}[31mred${ESC}[0m`), "red")
  assert.equal(clean(`${ESC}[1;32mok${ESC}[0m`), "ok")
  assert.equal(clean(`move${ESC}[5Acursor`), "movecursor")
})

test("clean: strips OSC sequences (terminator becomes a space)", () => {
  assert.equal(clean(`title${ESC}]0;evil${BEL}x`), "title x")
})

test("clean: remaining C0 control chars and DEL become spaces", () => {
  assert.equal(clean(`a${BEL}b\u0008c\u007fd`), "a b c d")
  assert.equal(clean("plain text"), "plain text")
})
