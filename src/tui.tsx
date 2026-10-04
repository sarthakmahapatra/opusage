import { createSignal } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import type { TabSelectOption } from "@opentui/core"

/**
 * Live usage widget in the session sidebar.
 *
 * Scope is switchable via a tab row — today / last 24h / last 7d / all.
 * A session counts toward a window if it was last active inside it (the same
 * `--active` semantics the CLI uses); each matching root session rolls up
 * its sub-agents, so every token is counted exactly once.
 *
 *   Usage · 3 sessions
 *   [today] [24h] [7d] [all]
 *   in 17.8M · out 64k · rsn 154k · cache 82% · cost $1.23
 */

type Scope = "today" | "24h" | "7d" | "all"

const HOUR = 3_600_000

const SCOPES: { key: Scope; name: string; description: string }[] = [
  { key: "today", name: "today", description: "active today" },
  { key: "24h", name: "24h", description: "last 24 hours" },
  { key: "7d", name: "7d", description: "last 7 days" },
  { key: "all", name: "all", description: "every session" },
]

// Module-level so the reference is stable across renders (the tab row is
// only (re)applied when it actually changes).
const TAB_OPTIONS: TabSelectOption[] = SCOPES.map((s) => ({
  name: s.name,
  description: s.description,
  value: s.key,
}))

function windowStart(scope: Scope): number {
  const now = Date.now()
  if (scope === "all") return 0
  if (scope === "24h") return now - 24 * HOUR
  if (scope === "7d") return now - 7 * 24 * HOUR
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Compact number: 64k, 17.8M, 1.2b — M is millions (SI), k is thousands. */
function fmt(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0"
  if (n < 1e3) return String(Math.round(n))
  const scale = (x: number) => (x >= 100 ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, ""))
  if (n >= 1e9) return scale(n / 1e9) + "b"
  if (n >= 1e6) return scale(n / 1e6) + "M"
  return scale(n / 1e3) + "k"
}

function money(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0.00"
  const abs = Math.abs(n)
  const digits = abs < 0.01 ? 4 : abs < 1 ? 3 : 2
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export default Plugin.define({
  id: "opusage",
  setup(context) {
    const [scope, setScope] = createSignal<Scope>("today")
    const [tick, setTick] = createSignal(0)

    // Nudge a re-render (debounced) whenever OpenCode reports any event, so
    // the numbers track live usage instead of going stale.
    let timer: ReturnType<typeof setTimeout> | undefined
    context.data.listen(() => {
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        setTick((t) => t + 1)
      }, 1000)
    })

    context.ui.slot({
      append: "sidebar.content",
      render: () => <UsagePanel />,
    })

    // The panel reads these from the setup closure.
    function UsagePanel() {
      const context = usePlugin()
      const theme = context.theme

      tick() // reactivity: recompute whenever the debounced event tick fires
      const active = scope()

      // Semantic colors from the active theme, so the panel follows any palette.
      const accent = theme.hue.accent[500]
      const muted = theme.text.muted
      const raised = theme.background.raised.base
      const info = theme.text.feedback.info.base
      const success = theme.text.feedback.success.base
      const warning = theme.text.feedback.warning.base

      let input = 0
      let output = 0
      let reasoning = 0
      let cacheRead = 0
      let cacheWrite = 0
      let cost = 0
      let members = 0

      const cutoff = windowStart(active)
      for (const s of context.data.session.list()) {
        if (s.time.archived) continue
        if (s.time.updated < cutoff) continue
        if (context.data.session.root(s.id) !== s.id) continue // roots only; sub-agents roll up
        members += 1
        for (const id of [s.id, ...(context.data.session.family(s.id) ?? [])]) {
          const m = context.data.session.get(id)
          if (!m) continue
          cost += m.cost ?? 0
          const t = m.tokens
          if (t) {
            input += t.input ?? 0
            output += t.output ?? 0
            reasoning += t.reasoning ?? 0
            cacheRead += t.cache?.read ?? 0
            cacheWrite += t.cache?.write ?? 0
          }
        }
      }

      const denom = input + cacheRead
      const hit = denom > 0 ? Math.round((cacheRead / denom) * 100) : 0


      // The stats row stretches to the sidebar width so long values wrap
      // instead of overflowing.
      const row = {
        flexDirection: "row" as const,
        flexGrow: 1,
        flexWrap: "wrap" as const,
        columnGap: 1,
      }
      const headerRow = {
        flexDirection: "row" as const,
        flexWrap: "no-wrap" as const,
        columnGap: 1,
      }

      return (
        <box shouldFill>
          <box {...headerRow}>
            <text fg={accent}>Usage</text>
            <text fg={muted}>· {members} {members === 1 ? "session" : "sessions"}</text>
          </box>
          <tab_select
            ref={(el) => {
              if (!el) return
              const i = SCOPES.findIndex((s) => s.key === scope())
              if (i >= 0) el.setSelectedIndex(i)
            }}
            options={TAB_OPTIONS}
            showDescription={false}
            textColor={muted}
            selectedTextColor={accent}
            selectedBackgroundColor={raised}
            onChange={(_, option) => {
              if (option && option.value) setScope(option.value as Scope)
            }}
          />
          <box {...row}>
            <text fg={info} wrapMode="word" truncate={false}>in {fmt(input)}</text>
            <text fg={muted}>·</text>
            <text fg={success} wrapMode="word" truncate={false}>out {fmt(output)}</text>
            <text fg={muted}>·</text>
            <text fg={warning} wrapMode="word" truncate={false}>rsn {fmt(reasoning)}</text>
            <text fg={muted}>·</text>
            <text fg={muted} wrapMode="word" truncate={false}>cache {denom > 0 ? hit + "%" : "–"}</text>
            <text fg={muted}>·</text>
            <text fg={muted} wrapMode="word" truncate={false}>cost {money(cost)}</text>
          </box>
        </box>
      )
    }
  },
})
