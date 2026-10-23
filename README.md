![Firefox MCP Connect icon: a browser window with a C and a text cursor](assets/icon-128.png)

# Firefox MCP Connect: let Claude use your Firefox

Unofficial, community-built with Claude (Claude Code + Cowork): lets Claude control your own Firefox. Firefox MCP Connect works in the Firefox you already use, with your own sign-ins, cookies, VPN and ad blocker. Claude can list and switch tabs, open pages, read them, take screenshots, click, type, press keys and scroll. You stay in control: there's an on/off switch, a log of every action, and password and payment fields are off limits.

It has two parts that talk to each other only on your computer:

- **The Claude MCP Connect add-on for Firefox**, which carries out the actions.
- **The Firefox MCP Connect plugin for Claude**, which gives Claude the browser tools. It works in Claude Code and in Cowork sessions on your computer. For chats in the Claude desktop app, use the desktop extension instead (see below).

> An independent community project. Not affiliated with, endorsed by, or supported by Anthropic or Mozilla.
> "Claude" is a trademark of Anthropic, and "Firefox" is a trademark of the Mozilla Foundation. They're used here only to say what this project works with.

## Install

You need Firefox 115 or newer, and Node.js 18 or newer on your computer, because the plugin runs a small local program with `node`.

1. **Firefox add-on:** install **Claude MCP Connect** from addons.mozilla.org, or open the signed `.xpi` from the [latest release](https://github.com/thriftshoppin/claude-firefox-bridge/releases) in Firefox. Click **Add**. Firefox asks whether to allow it in private windows. That's off by default, and you can leave it off.
2. **Copy the connection code:** a welcome page opens and copies the code for you. You can copy it again any time: click the Claude MCP Connect icon in Firefox's toolbar, then **Copy connection code**. If the icon is hidden, open the puzzle-piece Extensions menu.
3. **Claude plugin:** in Claude, go to **Customize > Plugins > Add > Add marketplace** and enter `thriftshoppin/claude-firefox-bridge`, then install **Firefox MCP Connect**. In Claude Code you can run this instead:
   ```
   /plugin install firefox-mcp-connect --marketplace thriftshoppin/claude-firefox-bridge
   ```
4. **Paste the code** when Claude asks for the **Connection code from Firefox**, then save.
5. The Claude MCP Connect icon in Firefox turns green **ON**. Ask Claude something like "open my Firefox and find today's weather".

**Claude desktop app chats:** install the one-click desktop extension `firefox-mcp-connect-<version>.mcpb` from the [latest release](https://github.com/thriftshoppin/claude-firefox-bridge/releases). Double-click it, click **Install**, and paste the same connection code.

## How it works

```
Claude (plugin or desktop extension)
   |  starts, over stdio
   v
MCP Connect bridge  (plugin/server/bridge.js, MCP server "firefox")
   |  WebSocket on 127.0.0.1:8765, connection code required
   v
Claude MCP Connect add-on in Firefox  ->  acts on the tab you're working in
```

Claude starts the bridge when it needs it and stops it when it closes. There's nothing to keep running. The add-on reconnects quietly until a bridge is there. If several Claude apps run at once, they share one connection: the first bridge holds it, and the others pass their calls through it.

## Tools

| Tool | What it does | Changes anything? |
|---|---|---|
| `tabs_list` | Lists open tabs | No |
| `tab_open` | Opens a new tab at a URL | Opens a tab |
| `tab_select` | Switches to a tab | Switches tabs |
| `tab_close` | Closes a tab | Yes |
| `navigate` | Loads a URL, or goes back or forward | Yes |
| `screenshot` | Captures the visible page; pixels equal CSS pixels | No |
| `read_page` | Lists the page's visible elements with refs | No |
| `get_page_text` | Returns the page's visible text | No |
| `find` | Finds elements by text or label | No |
| `click` | Clicks an element or a point | Yes |
| `type` | Types into a field | Yes |
| `key` | Presses keys such as Enter or ctrl+a | Yes |
| `scroll` | Scrolls the page or an element | Scrolls |
| `form_input` | Sets a select, checkbox or radio | Yes |
| `wait` | Waits up to 10 seconds | No |

The plugin also includes a skill that tells Claude to work in a new tab, to treat page content as untrusted, and to ask before buying, sending, posting or deleting anything.

## Safety

- **Local only.** The bridge listens on 127.0.0.1, so nothing outside your computer can reach it.
- **Connection code.** Only a connection that presents your code is accepted. The code is random and 64 characters long, and the add-on can make a new one at any time (Options > New code).
- **Firefox add-ons only.** The bridge refuses connections from web pages, because only a `moz-extension://` origin may connect as the add-on.
- **Kill switch.** The checkbox in the add-on's popup disconnects Claude immediately.
- **Action log.** The popup shows the last 20 of up to 300 logged actions. The log stays on your computer.
- **Blocked fields.** Typing into password, credit-card (`autocomplete="cc-*"`) and one-time-code fields is refused.
- **Blocked pages.** Firefox's own pages (`about:`, `moz-extension:`, `view-source:`) and addons.mozilla.org are refused.

## Privacy

Neither part collects anything or sends anything to its authors or any third party. Page content Claude reads goes to the Claude app that asked for it, as part of your conversation. Read the full [privacy policy](https://thriftshoppin.github.io/claude-firefox-bridge/privacy), also in [docs/privacy.md](docs/privacy.md).

## Troubleshooting

- **Claude says Firefox isn't connected.** Check that Firefox is open and the Claude MCP Connect icon shows **ON**. If it shows **…**, the codes probably don't match: copy the code again from the icon's popup and paste it into the plugin's settings in Claude.
- **The icon shows OFF.** The kill switch is off. Open the popup and tick **Bridge enabled**.
- **Another program uses port 8765.** Pick another port, such as 8777, in both the add-on's Options and the plugin's settings.
- **`node` not found.** Install Node.js 18 or newer from nodejs.org, then restart Claude.
- **A site ignores clicks or typing.** See the known limits below.

## Known limits

- Clicks and keys are synthetic events. Sites that check for real input, and some editors, games and canvas apps, may ignore them.
- Content inside embedded frames from other sites, such as some logins, captchas and payment widgets, can't be reached.
- `key` imitates default browser behavior only for Enter, Tab, ctrl+a, Backspace and the page-scrolling keys.
- Native select dropdowns and file pickers can't be opened. Use `form_input` for selects.

## For developers

| Path | What it is |
|---|---|
| `plugin/` | The Claude plugin: `.claude-plugin/plugin.json`, the bridge `server/bridge.js` (one readable file, no dependencies), the skill and the icon. Only this folder is installed |
| `extension/` | The Firefox add-on (Manifest V2) |
| `.claude-plugin/marketplace.json` | Lets people install the plugin straight from this repository |
| `mcpb/manifest.json` | Manifest for the one-click desktop extension |
| `test/` | Tests: `npm install`, then `node stdio-test.mjs` and `node selftest.mjs` |
| `build-mcpb.ps1`, `sign.ps1`, `fetch-signed.ps1` | Build the `.mcpb`; sign and download the add-on through Mozilla's API |
| `amo/` | Notes for Mozilla's add-on reviewers |

`test/e2e.mjs` runs a live check in a throwaway Firefox profile with `web-ext run`. `test/ffcall.mjs` makes one tool call through a running bridge from a terminal.

## How this was built

Claude designed and wrote this project: the add-on, the bridge, the plugin, the tests and these docs. It worked through Claude Code in VS Code and Claude Cowork, at the direction of [thriftshoppin](https://github.com/thriftshoppin). It follows Anthropic's directory policy for plugins: every tool has annotations, page content is treated as untrusted, typing into password, payment and one-time-code fields is blocked, and all data stays on your computer.

Being built with Claude doesn't make this an Anthropic product. It isn't affiliated with, made by, reviewed by or endorsed by Anthropic or Mozilla.

## Credits

- Icon: an original design, not the Claude or Firefox logo. The icon lettering uses [Newsreader](https://github.com/productiontype/Newsreader) by Production Type, licensed under the SIL Open Font License 1.1 ([assets/Newsreader-OFL.txt](assets/Newsreader-OFL.txt)).
- An orange icon and a white version for light backgrounds are in [assets/](assets/).

## License

[MIT](LICENSE)
