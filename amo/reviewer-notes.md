# Notes to reviewer: TabRelay

TabRelay is a bridge between Firefox and a local program, the TabRelay bridge. The user's AI assistant, Claude, starts the bridge on the same computer. The add-on opens a WebSocket only to ws://127.0.0.1:<port> (default 8765, set in Options) and executes the browser commands the bridge sends. It never contacts a remote server.

## Source
All code is plain, unminified JavaScript. There's no build step: the files in the submitted package are the source.
Public repository: https://github.com/thriftshoppin/claude-firefox-bridge (folder `extension/`).

## How to test
1. Install Node.js 18 or newer.
2. Clone the repository. In Firefox, install this add-on. The welcome page shows and copies a connection code. Copy it again from the toolbar popup if needed.
3. In a terminal, from the repository root, start the bridge with the code:
   `FF_BRIDGE_TOKEN=<code> node server/bridge.js` (Windows PowerShell: `$env:FF_BRIDGE_TOKEN='<code>'; node server/bridge.js`)
   The bridge has no dependencies. It prints "Firefox add-on connected" to stderr, and the toolbar badge turns green "ON".
4. To send commands without Claude, run `npm install` in `test/`, then from `test/`:
   `FF_BRIDGE_TOKEN=<code> node ffcall.mjs tabs_list '{}'`
   `FF_BRIDGE_TOKEN=<code> node ffcall.mjs tab_open '{"url":"https://example.com"}'`
   `FF_BRIDGE_TOKEN=<code> node ffcall.mjs get_page_text '{}'`
   ffcall starts its own bridge copy, which joins the bridge from step 3 as a relay.
5. Untick "Bridge enabled" in the popup: the connection closes at once, and the badge shows OFF.

## Permissions
| Permission | Why it's needed |
|---|---|
| `tabs` | List, open, switch, close and navigate tabs, and read tab titles and URLs for `tabs_list`. |
| `<all_urls>` | Inject `content.js` on demand into the tab the user asked Claude to work in, for reading text, finding elements, clicking and typing. Also needed by `tabs.captureVisibleTab` for screenshots. Nothing is injected until the user asks Claude to act on a page. |
| `activeTab` | Screenshot and page access for the active tab. |
| `storage` | Keeps the connection code, port, on/off switch and local action log in `storage.local`. |
| `clipboardWrite` | Lets the welcome page and popup copy the connection code, so the user can paste it into Claude. |

## Data handling
- `data_collection_permissions: none`. Nothing is sent anywhere except to the local bridge on 127.0.0.1, which the user's own Claude app starts.
- Page content returned to the bridge goes to the user's Claude conversation at the user's request. That's the add-on's purpose.
- Typing into `input[type=password]` and into fields with `autocomplete` containing `cc-` or `one-time-code` is refused in `content.js`.
- Privileged pages (about:, moz-extension:, view-source:, data:) and addons.mozilla.org are refused in `background.js`.
