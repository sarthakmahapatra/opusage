#!/usr/bin/env node
//
// opusage — token & cost usage for OpenCode.
//
// Plain JS on purpose: Node refuses to type-strip TypeScript files under
// node_modules, so the CLI is bundled to dist/cli.js at publish time
// (esbuild, see scripts/build.mjs). The TUI widget (src/tui.tsx) stays
// TypeScript — OpenCode's bun runtime executes it directly.
//
// Requires Node.js >= 23.6 (node:sqlite), or 22.5+ with --experimental-sqlite.
//
import { main } from "../dist/cli.js"

main(process.argv.slice(2))
