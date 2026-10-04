/** 1234 -> "1.2k", 1234567 -> "1.2M", 12345678 -> "12M" — M is millions (SI) */
export function human(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "-"
  if (n < 1e3) return String(Math.round(n))
  const scale = (x: number) => (x >= 100 ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, ""))
  if (n >= 1e9) return scale(n / 1e9) + "b"
  if (n >= 1e6) return scale(n / 1e6) + "M"
  return scale(n / 1e3) + "k"
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
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csv(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows].map((r) => r.map(escapeCsv).join(",")).join("\n")
}
