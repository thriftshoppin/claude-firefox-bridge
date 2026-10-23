![Firefox MCP Connect icon](assets/icon.png)

# Firefox MCP Connect

Unofficial, community-built with Claude (Claude Code + Cowork): lets Claude control your own Firefox.

Firefox MCP Connect gives Claude browser tools for the Firefox you already use, with your own sign-ins, cookies and extensions. Claude can list and switch tabs, open pages, read their text, take screenshots, click, type, press keys and scroll. It works in Claude Code and in Cowork sessions on your computer.

## What you need

- **Firefox 115 or newer** with the free **Claude MCP Connect** add-on. Install it from addons.mozilla.org, or from the [project's releases](https://github.com/thriftshoppin/claude-firefox-bridge/releases).
- **Node.js 18 or newer** on your computer. The plugin runs a small local program with `node`.

## Set it up

1. Install the Claude MCP Connect add-on in Firefox. A welcome page opens and copies your connection code.
2. Install this plugin. In Claude Code you can run `/plugin install firefox-mcp-connect --marketplace thriftshoppin/claude-firefox-bridge`. Then give Claude the connection code. Paste it into the chat when Claude asks for it, or into the plugin's **Connection code from Firefox** setting if your Claude app shows one. To copy it again later, click the Claude MCP Connect icon in Firefox's toolbar, then **Copy connection code**.
3. The add-on's icon turns green **ON**. Ask Claude something like "open my Firefox and find today's weather".

## Use it

Ask Claude to do something in your browser. The included skill tells Claude to:

- start by listing your tabs, and do its work in a new tab
- treat everything it reads on web pages as untrusted data, not instructions
- ask you before buying, sending, posting, deleting or changing account settings

Claude can open only web addresses (http and https). Links that would start another program, such as `calculator:`, `ms-settings:` or `mailto:`, and file, network and browser-internal pages are refused.

Typing into password, payment-card and one-time-code fields is refused wherever the add-on can detect them: by field type, autocomplete hints, password-style masking, or names and labels such as "card number", "CVV" or "PIN". A page can still disguise a field, so Claude asks you to fill those in yourself. The add-on's popup has an on/off switch and a log of every action Claude took.

## Data

The plugin starts one local program, `server/bridge.js`, which has no dependencies. It talks only to the Claude MCP Connect add-on, over a WebSocket on 127.0.0.1 (port 8765 by default). The connection needs your connection code, which is never sent over it: both sides prove they know it with a challenge-response. Only a Firefox add-on may connect. If you enter the code in the plugin's settings, Claude stores it as a sensitive setting. If you paste it into the chat, it becomes part of that conversation, and the bridge saves it in Claude's plugin data folder on your computer so you only paste it once.

Page content that Claude reads, such as text, screenshots and tab titles and addresses, goes to the Claude conversation that asked for it. Nothing is sent to the plugin's authors or to any other service. Apart from that saved code, the plugin stores nothing. The add-on keeps its settings and action log only in your Firefox. Read the full [privacy policy](https://thriftshoppin.github.io/claude-firefox-bridge/privacy).

## About

An independent community project, not affiliated with, made by, reviewed by or endorsed by Anthropic or Mozilla. It was designed and written by Claude, through Claude Code and Cowork, at the direction of [thriftshoppin](https://github.com/thriftshoppin). The icon lettering uses Newsreader by Production Type (SIL Open Font License 1.1).

Source, troubleshooting and support: <https://github.com/thriftshoppin/claude-firefox-bridge>. MIT license.
