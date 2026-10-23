# Changelog

All notable changes to Firefox MCP Connect (the Claude plugin and its bridge) and Claude MCP Connect (the Firefox add-on).

## Plugin 1.0.6 and add-on 1.0.5: October 23, 2026 (security update)

Found by a penetration test run from Claude Cowork, which attacked the latest builds through the tools themselves. Update both the add-on and the plugin. Details are in [SECURITY-AUDIT.md](SECURITY-AUDIT.md), Audit 2.

### Security
- **Only web addresses can be opened (SEC-13, medium).** `tab_open` and `navigate` used to accept app links such as `calculator:`, `ms-settings:`, `search-ms:` and `vscode:`. Firefox then asked "Allow Claude MCP Connect to open this link with …?", so one click, or the "Always allow" box ticked once, would let a prompt-injected page start Windows programs. Now only `http` and `https` are allowed. The bridge checks this, and the add-on checks it again. This also closes `view-source:` and `moz-extension:` tabs (SEC-14).
- **Links to apps or mail can't be clicked (SEC-15).** Clicking an in-page link that uses another scheme, such as `calculator:`, `ms-settings:` or `mailto:`, is refused. Ordinary `javascript:` in-page links still work.
- **No keys reach a protected field (SEC-16).** While a password, payment-card or one-time-code field is focused, every key is refused, including shortcuts like Ctrl+V. Before, only plain typing was.
- **Re-pairing can't break a working connection (SEC-17).** A code pasted into `connect_firefox` is now saved only after the add-on has logged in with it. A wrong or garbled code leaves the working code in place and says so.

### Tests
- The selftest now runs 59 checks: 16 refused address types, verify-before-save pairing, and status.
- The live attack suite now runs 30 checks: app and file addresses (refused by the bridge, and by the add-on on its own), link clicks, and keys on a focused password field.

## Plugin 1.0.5: October 23, 2026

- New `connection_status` tool. It reports the bridge version, whether Firefox is connected, the add-on's version and login type, and whether the add-on is up to date. It also tells the user how to update an outdated add-on, such as one still using the old login from version 1.0.3 or earlier. Before this, Claude had no way to tell which versions it was running.
- The add-on was unchanged in this release.

## 1.0.4: October 23, 2026 (security update)

Recommended for everyone. Update both the add-on and the plugin. Full details, evidence and test results are in [SECURITY-AUDIT.md](SECURITY-AUDIT.md).

### Security
- **The add-on now obeys only the real bridge (SEC-1, high).** Before, a program listening on the bridge's port could send the add-on commands. The add-on now ignores every message until the bridge has proved it knows your connection code.
- **The connection code is never sent any more (SEC-2).** The add-on and the bridge now log in with a challenge-response (HMAC-SHA256), so a program squatting on the port learns nothing it can reuse. Bridge copies that relay through each other verify the same way.
- **Pages can no longer hijack Claude's typing (SEC-3).** Element references now live only inside the add-on, so a page can't see them or plant an element that answers to one.
- **Better blocking of sensitive fields (SEC-4).** Typing is now refused in more password, payment-card and one-time-code fields: those with card-number, CVV, expiry or PIN names and labels, password-style masking, and fields inside shadow DOM.
- **The bridge resists floods before login (SEC-5).** Messages before login are capped at 8 KB, and at most 16 connections may wait to log in.
- **Commands are matched only by their own names (SEC-6).** Built-in names such as `constructor` are no longer accepted.
- **The action log no longer stores typed text (SEC-7).** It records only how many characters were typed.
- **Error messages no longer echo unlimited input (SEC-8).**
- The repository's `main` branch is now protected, and private vulnerability reporting is on ([SECURITY.md](SECURITY.md)).

### Compatibility
- The 1.0.4 bridge still accepts the old login from add-on 1.0.3 and earlier, so nothing breaks while the add-on update rolls out. A later release will remove the old login.

### Tests
- New `test/security-e2e.mjs`: a malicious page and a port squatter tested against the real add-on in a throwaway Firefox.
- `test/selftest.mjs` adds security cases and now runs 49 checks.

## 1.0.3: October 23, 2026
- First public release: the plugin for Claude Code and Cowork, a one-click desktop extension, and the add-on on addons.mozilla.org.
- Pair by pasting the connection code in the chat (`connect_firefox`), for Claude apps that can't show plugin settings, such as Cowork.
- Welcome page that copies the connection code and has a "Back to Claude" button.
- Dependency-free bridge; several bridge copies share one Firefox connection.
