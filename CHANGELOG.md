# Changelog

All notable changes to Firefox MCP Connect (the Claude plugin and its bridge) and Claude MCP Connect (the Firefox add-on).

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
