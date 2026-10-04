#!/usr/bin/env node
//
// opusage — token & cost usage for OpenCode.
//
// Zero runtime dependencies: this shim imports the TypeScript sources
// directly and relies on Node's native type stripping.
//
// Requires Node.js >= 23.6, or Node 22.5+ with --experimental-strip-types.
//
import { main } from "../src/index.ts"

main(process.argv.slice(2))
