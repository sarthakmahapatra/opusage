const UNITS = [1e3, 1e6, 1e9, 1e12] as const
const SUFFIX = ["k", "M", "b", "t"] as const

/** 1234 -> "1.2k", 1234567 -> "1.2M", 999600 -> "1M" — M is millions (SI) */
export function human(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "-"
  if (n < 1e3) return String(Math.round(n))
  let i = UNITS.length - 1
  while (n < UNITS[i]) i--
  const scale = (x: number) => (x >= 100 ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, ""))
  let text = scale(n / UNITS[i])
  // Promote when rounding bumps the value onto the next unit (999.6k -> 1M).
  if (text === "1000" && i < UNITS.length - 1) {
    i += 1
    text = scale(n / UNITS[i])
  }
  return text + SUFFIX[i]
}

/** $0 -> "$0.00", $0.0041 -> "$0.0041", $1.234 -> "$1.23" */
export function money(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0.00"
  const abs = Math.abs(n)
  const digits = abs < 0.01 ? 4 : abs < 1 ? 3 : 2
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function pct(x: number): string {
  if (!Number.isFinite(x) || x <= 0) return "-"
  return `${Math.round(x * 100)}%`
}

export function date(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Truncate a string to `width` cells, eliding the middle. */
export function clip(s: string, width: number): string {
  if (s.length <= width) return s
  if (width <= 3) return s.slice(0, width)
  return s.slice(0, width - 2) + "…"
}

/**
 * Render an aligned table. Column 0 is left-aligned, the rest are
 * right-aligned. `rows` are pre-formatted strings.
 */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)))
  const all = [headers, ...rows]
  return all
    .map((line, li) =>
      line
        .map((cell, i) => {
          const s = cell ?? ""
          return li === 0 || i === 0 ? s.padEnd(widths[i]) : s.padStart(widths[i])
        })
        .join("  "),
    )
    .join("\n")
}

function escapeCsv(v: string | number): string {
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Remove terminal escape sequences and C0 control characters from a label.
 *
 * Session titles are LLM-generated summaries of the conversation, so a title
 * can legitimately contain ESC[...m color codes or other control bytes. In
 * table output (which goes straight to the user's terminal) those would be
 * emitted verbatim — a small terminal-injection/bleed vector. JSON and CSV
 * output deliberately keep the raw values (they are data, and both formats
 * escape or quote control characters safely).
 */
export function clean(s: string): string {
  return s
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "") // CSI sequences (colors, cursor moves)
    .replace(/\u001b\][^\u0007\u001a]*/g, "") // OSC sequences (window titles)
    .replace(/[\u0000-\u001f\u007f]/g, " ") // remaining C0 + DEL -> spaces
}

export function csv(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows].map((r) => r.map(escapeCsv).join(",")).join("\n")
}
