import { Plugin } from "@opencode/plugin"

/**
 * No-op server entry.
 *
 * opusage's CLI (bin/opusage.js) never imports this file. It exists so the
 * package can be registered in opencode.json: the TUI widget lives in the
 * `./tui` entrypoint, which OpenCode loads automatically.
 */
export default Plugin.define({
  id: "opusage.server",
  async setup() {},
})
