#!/usr/bin/env node
//
// Bundle the CLI for publication.
//
// Node refuses to type-strip TypeScript files under node_modules, so the
// published package ships the CLI as a single compiled ESM file (dist/cli.js)
// while the TUI widget ships as TSX — OpenCode runs plugins under bun, which
// executes TypeScript directly with no such restriction.
//
// The CLI has zero runtime dependencies, so the bundle inlines everything.
//

import { build } from "esbuild"
import { mkdir, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outdir = path.join(root, "dist")

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

await build({
  entryPoints: [path.join(root, "src", "index.ts")],
  outfile: path.join(outdir, "cli.js"),
  bundle: true,
  format: "esm",
  platform: "node", // node: builtins are external automatically
  target: "node18", // syntax only — the node:sqlite runtime requirement is unchanged (>=23.6 / 22.5+ flag)
  packages: "external", // nothing to externalize (zero deps), but keep the invariant explicit
  logLevel: "silent",
})

// The TUI widget stays TSX (bun executes it directly); verify nothing else
// in src/ is expected to be compiled here.
console.log(`built dist/cli.js`)
