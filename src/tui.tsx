import { Plugin, usePlugin } from "@opencode/plugin/tui"

/**
 * Live usage widget: a compact panel in the session sidebar showing the
 * session's (plus all sub-agents') token usage, cache hit rate, and cost.
 *
 * Data comes from OpenCode's session aggregates (Session.Info), which OpenCode
 * updates as the session runs, so the panel stays current without polling.
 */
export default Plugin.define({
  id: "opusage",
  setup(context) {
    // Load marker: proves setup() ran; inspectable via plugin storage.
    const [, updateMarker] = context.storage.store("load-marker", { initial: { at: 0 } })
    void updateMarker((draft) => {
      draft.at = Date.now()
    })
    context.ui.toast.show({ title: "opusage", message: "usage panel loaded", variant: "success" })

    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <UsagePanel sessionID={props.sessionID} />,
    })
  },
})

function fmt(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0"
  if (n < 1e3) return String(Math.round(n))
  const scale = (x: number) => (x >= 100 ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, ""))
  if (n >= 1e9) return scale(n / 1e9) + "b"
  if (n >= 1e6) return scale(n / 1e6) + "m"
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

  const total = input + output + reasoning + cacheRead + cacheWrite
  const denom = input + cacheRead
  const hit = denom > 0 ? Math.round((cacheRead / denom) * 100) : 0
  const fg = context.theme.text.base

  return (
    <box>
      <text fg={fg}>usage   {fmt(total)} tokens{members > 1 ? ` · ${members} sessions` : ""}</text>
      <text fg={fg}>in {fmt(input)} · out {fmt(output)} · rsn {fmt(reasoning)}</text>
      <text fg={fg}>cache {fmt(cacheRead)} read · {fmt(cacheWrite)} write · {hit}% hit</text>
      <text fg={fg}>cost    {money(cost)}</text>
    </box>
  )
}
