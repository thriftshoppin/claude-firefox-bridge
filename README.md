# Claude Browser Bridge (for Firefox)

Lets Claude drive your real Firefox through MCP: tabs, navigation, screenshots, reading pages, clicking, typing, keys and scrolling. It keeps your own sign-ins, VPN and ad blocker.
It works from the Claude desktop app (chat, Cowork and Code) and from Claude Code.

> An independent community project. Not affiliated with, endorsed by, or supported by Anthropic or Mozilla.
> "Claude" is a trademark of Anthropic, and "Firefox" is a trademark of the Mozilla Foundation. They're used here only to say what this works with.

```
Claude app / Claude Code --stdio--> bridge/bridge.js (MCP server "firefox")
                                         |  WebSocket on 127.0.0.1:8765, token auth
                                Firefox add-on "Claude Browser Bridge"
                                         |
                                content.js injected into a tab on demand
```

There is no server to keep running. Claude starts `bridge.js` itself and stops it on quit. The add-on retries quietly, every 1 to 10 seconds, until a bridge is there.

## Several Claude surfaces at once
The desktop app starts one bridge copy for chats and another for Cowork and Code sessions. Claude Code may start a third.
The first copy to take port 8765 is the **primary** and holds the Firefox connection. Every later copy joins it as a **relay** and passes its calls through.
If the primary exits, a relay takes over the port within about a second, and Firefox reconnects to it. Every surface reaches the same Firefox.

## Setup (one-click, Claude desktop app)
You need two files: `claude-browser-bridge-<version>.xpi`, the Firefox add-on, and `claude-browser-bridge-<version>.mcpb`, the Claude desktop extension. No Node.js install or config editing is needed, because Claude runs the bridge with its built-in Node.

1. **Firefox:** open the `.xpi` in Firefox and click **Add**. The add-on creates its own connection code on first run.
2. **Copy the code:** click the **Claude Browser Bridge** icon in Firefox's toolbar, then **Copy connection code**. If the icon is hidden, open the puzzle-piece Extensions menu first.
3. **Claude:** double-click the `.mcpb`, or drag it onto Claude's Settings > Extensions page. Click **Install**, paste the code into **Connection code from Firefox**, and save.
4. The add-on's toolbar badge turns green **ON**, and Claude has the Firefox tools.

If you ever click **New code** in the add-on's Options, paste the new code into Claude's extension settings again.

## Setup (manual, for Claude Code or a hand-edited desktop config)
1. Install Node.js 20 or newer, then run `npm install` in `bridge/`.
2. Copy the connection code from the Firefox add-on as above.
3. Add this to `mcpServers` in `claude_desktop_config.json`. Merge it in and keep the existing servers.
   ```json
   "firefox": {
     "command": "node",
     "args": ["C:/path/to/claude-firefox-bridge/bridge/bridge.js"],
     "env": { "FF_BRIDGE_TOKEN": "<token>", "FF_BRIDGE_PORT": "8765" }
   }
   ```
   Use forward slashes in the path, because backslashes are easy to mangle in JSON.
   Config location:
   - Windows, standard installer: `%APPDATA%\Claude\claude_desktop_config.json`
   - Windows, Microsoft Store build: `%LOCALAPPDATA%\Claude-Data\<package>\claude_desktop_config.json`, where the package folder is named like `claude_pzs8sxrjxfjjc`
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

   For Claude Code, add it with the CLI instead:
   `claude mcp add firefox --scope user -e FF_BRIDGE_TOKEN=<token> -e FF_BRIDGE_PORT=8765 -- node /path/to/bridge/bridge.js`
4. Fully quit the Claude desktop app from the tray icon and reopen it. The add-on's badge turns green **ON**.

Use the connection code from the add-on as `<token>`. You can also put your own code into both places: paste it into the add-on's Options and click Save.

Badge: **ON** means connected, **…** means enabled and waiting for Claude, and **OFF** means disabled. The popup checkbox is the kill switch. The popup also shows the last 20 actions, and 300 are kept.

## Tools
tabs_list, tab_open, tab_select, tab_close, navigate (a URL, back or forward), screenshot (a PNG in CSS pixels, so coordinates match click), read_page, get_page_text, find, click, type, key, scroll, form_input, wait.

## Safety
- The WebSocket binds to 127.0.0.1 only. The first message must carry the token, or the socket is closed. Relay copies use the same token.
- Typing into password, credit-card (`autocomplete=cc-*`) and one-time-code fields is refused.
- about:, moz-extension:, view-source:, data: and addons.mozilla.org pages are refused.

## Driving Firefox from a terminal
`node bridge/ffcall.mjs tabs_list '{}'` makes one tool call through the running bridge and prints the result. It joins as a relay and reads the token from the Claude config without printing it.

## Building and signing (maintainers)
- `build-mcpb.ps1` copies `bridge/bridge.js` into `mcpb/server/`, installs runtime dependencies, validates `mcpb/manifest.json`, and packs `dist/claude-browser-bridge-<version>.mcpb`.
  Keep the version in `mcpb/manifest.json` in step with `extension/manifest.json`.
- `sign.ps1` lints and signs the add-on as an unlisted AMO add-on. It asks for the AMO JWT issuer and secret and keeps them in memory only.
  It never packages `local-config.json`. Bump `version` in `extension/manifest.json` before each signing.
- AMO rejects add-on names that contain "Firefox" or "Mozilla".
- `extension/local-config.json` is an optional token file for unsigned temporary installs. It is listed in `.gitignore`, and you should never ship it.

## Tests (in `bridge/`)
- `node stdio-test.mjs`: clean stdout, initialize, and all 15 tools listed.
- `node selftest.mjs`: a fake add-on checks routing, wrong-token rejection, newest-connection-wins, relay routing, primary takeover, and a foreign process holding the port.
- `node e2e.mjs <testExtensionDir> <profileDir> <outDir>`: a live run in a throwaway Firefox profile via `web-ext run`. It needs a test copy of the add-on with `local-config.json` set to `{token: "e2e-test-token-not-real", port: 18766, enabled: true}`.

## Known limits
- Events are synthetic (`isTrusted: false`). Sites that check for that, or that need real keyboard input, may ignore clicks and keys. Some editors, games and canvas apps behave this way.
- The content script runs in the top frame only, so refs can't reach cross-origin iframes such as embedded logins, captchas and some payment widgets.
- `key` imitates default browser behavior only for Enter, Tab, ctrl+a, Backspace and the page-scrolling keys.
- Native `<select>` dropdowns and file pickers can't be opened. Use `form_input` for selects.
