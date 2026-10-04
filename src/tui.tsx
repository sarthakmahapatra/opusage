import { Plugin, usePlugin } from "@opencode/plugin/tui"

/**
 * Live usage widget: a compact panel in the session sidebar showing the
 * session's (plus all sub-agents') token usage, cache hit rate, and cost.
 *
 * Data comes from OpenCode's session aggregates (Session.Info), which OpenCode
 * updates as the session runs, so the panel stays current without polling.
 *
 * Layout — a "Usage" header (accent) with the session count (muted), then one
 * flowing row of stats that wraps at the sidebar width. in/out/rsn each have
 * their own color; the session count, cache, and cost use the muted color so
 * they sit visually behind the primary numbers:
 *   Usage · 2 sessions
 *   in 17.8M · out 64k · rsn 154k · cache 82% · cost $1.23
 */
export default Plugin.define({
  id: "opusage",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <UsagePanel sessionID={props.sessionID} />,
    })
  },
})

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

function UsagePanel({ sessionID }: { sessionID?: string }) {
  const context = usePlugin()
  const theme = context.theme

  let input = 0
  let output = 0
  let reasoning = 0
  let cacheRead = 0
  let cacheWrite = 0
  let cost = 0
  let members = 0

  if (sessionID) {
    // The root session plus every descendant (sub-agent) session.
    const ids = [sessionID, ...(context.data.session.family(sessionID) ?? [])]
    for (const id of ids) {
      const s = context.data.session.get(id)
      if (!s) continue
      members += 1
      cost += s.cost ?? 0
      const t = s.tokens
      if (t) {
        input += t.input ?? 0
        output += t.output ?? 0
        reasoning += t.reasoning ?? 0
        cacheRead += t.cache?.read ?? 0
        cacheWrite += t.cache?.write ?? 0
      }
    }
  }

  if (!sessionID) return <box shouldFill={false} />

  // Semantic colors from the active theme, so the panel follows any palette.
  const accent = theme.hue.accent[500]
  const muted = theme.text.muted
  const info = theme.text.feedback.info.base
  const success = theme.text.feedback.success.base
  const warning = theme.text.feedback.warning.base

  const denom = input + cacheRead
  const hit = denom > 0 ? Math.round((cacheRead / denom) * 100) : 0

  // The stats row stretches to the sidebar width so long values wrap
  // instead of overflowing.
  const headerRow = { flexDirection: "row" as const, flexWrap: "no-wrap" as const, columnGap: 1 }
  const row = { flexDirection: "row" as const, flexGrow: 1, flexWrap: "wrap" as const, columnGap: 1 }

  return (
    <box shouldFill>
      <box {...headerRow}>
        <text fg={accent}>Usage</text>
        {members > 1 ? <text fg={muted}>· {members} sessions</text> : null}
      </box>
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
