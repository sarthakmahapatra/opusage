# opusage

Track [OpenCode](https://opencode.ai)'s token usage and cost per **project**, **model**, and **session** — a zero-dependency CLI, plus a live TUI widget.

`opusage` reads OpenCode's local SQLite database directly. No server, no API, nothing to configure.

```
$ opusage --days 2
opusage · last 2d · 10 sessions · ~/.local/share/opencode/opencode.db
project       sessions  in     out    rsn   cache  hit  cost   total
try_opencode         9  73.5m   467k  892k     2m   3%  $0.00  76.9m
try_pi               1   2.7m  24.6k   53k      0    -  $0.00   2.8m

total               10  76.2m   492k   945k     2m   3%  $0.00  79.7m

$ opusage --sessions 4
session                                  sessions  in     out    rsn    cache  hit  cost   total
Kalshi perpetuals explained                     4  45.8m   260k   403k      0    -  $0.00  46.4m
Modern Pac-Man game                             5    25m   185k   448k     2m   7%  $0.00  27.7m
OpenCode + LM Studio memory pr…                 1   2.7m  24.6k    53k      0    -  $0.00   2.8m
OpenCode token consumption las…                 1   2.6m  17.1k  33.6k      0    -  $0.00   2.6m

2 of 4 sessions include sub-agent usage            76.2m   492k   945k     2m   3%  $0.00  79.7m

total                                          10  76.2m   492k   945k     2m   3%  $0.00  79.7m
```

## Features

- **Three views** — per-project (default), `--models`, `--sessions [N]`
- **Sub-agent rollup** — child sessions (sub-agents) are attributed to their root session, so totals are never double-counted
- **Time windows** — `--days 2`, `--since 2026-10-01` (matches session start by default; `--active` matches last activity)
- **Filters** — `--project .` (current project) or any path/name/ID
- **Output** — aligned table (default), `--format json`, `--format csv`
- **Zero dependencies** — uses Node's built-in `node:sqlite`; no `node_modules`, no native builds, works offline
- **Read-only** — opusage never writes to OpenCode's database
- **Live TUI widget** — optional sidebar panel with real-time per-session usage (see below)

## Cost tracking

Costs are whatever OpenCode recorded per session, which OpenCode computes from provider pricing (the models.dev catalog). That means:

- **Paid providers** (OpenAI, Anthropic, …) → real USD costs
- **Local/free providers** (LM Studio, Ollama, …) → `$0.00` — for those, tokens are the meaningful metric

## Requirements

- Node.js ≥ 23.6 (or ≥ 22.5 with `--experimental-strip-types`)
- OpenCode v2 (built and tested against v2.0.22)

## Install

```sh
npm install -g opusage
```

Or run from a checkout without installing:

```sh
git clone https://github.com/<you>/opusage
node opusage/bin/opusage.js --help
```

## Usage

```
opusage [options]              per-project summary (default view)
opusage --models [options]     per-model breakdown
opusage --sessions [N] [opts]  per-session table (top N, default 15)

Time:
  --days <n>                   only sessions started in the last n days
  --since <date|epoch-ms>      only sessions started after the given time
  --active                     match on last activity instead of session start

Filter:
  --project <path|name|id>     one project only; "." = the current project

Output:
  --format <table|json|csv>    output format (default table)
  --top <n>                    max rows (default 15; 0 = all)
  --db <path>                  database file (default: auto-detected)
```

The database is auto-detected from `$OPENCODE_DB`, `$XDG_DATA_HOME/opencode/`, `~/.local/share/opencode/`, and (on Windows) `%APPDATA%\opencode\`. The canonical location is `opencode debug paths db`.

Scripting example:

```sh
opusage --days 7 --models --format json > models-week.json
opusage --format csv | column -s, -t
```

## TUI widget

opusage also ships an OpenCode TUI plugin that pins a live usage panel to the session sidebar — tokens, cache hit rate, and cost for the session *including sub-agents*, updated as you chat.

Add it to `~/.config/opencode/opencode.json` (or `cli.json` if you connect to a remote server):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opusage"]
}
```

Restart OpenCode and open any session:

```
usage   1.2m tokens · 3 sessions
in 1.1m · out 8.4k · rsn 3.1k
cache 12.3k read · 1.2k write · 18% hit
cost    $1.23
```

(Requires OpenCode v2 with the V2 plugin API; the widget uses the `Session.Info` aggregates, so it needs no database access of its own.)

## Caveats

- opusage reads OpenCode's **internal** database schema (`session_v2`). If a future OpenCode release renames columns, opusage fails with a clear error rather than silently misreporting — check for updates or file an issue.
- Time windows match on **session start** by default, because OpenCode stores cumulative per-session counters (not per-message tokens). A session that started before the window isn't counted, even if it was active inside it. `--active` gives the "touched in the window" semantics.
- `hit` = `cache_read / (input + cache_read)` — the share of prompt tokens served from the cache.

## Development

No build step:

```sh
node bin/opusage.js --help
```

Type-checking (requires network for `npm install`):

```sh
npm install
npm run typecheck
```

## License

MIT — see [LICENSE](LICENSE).
