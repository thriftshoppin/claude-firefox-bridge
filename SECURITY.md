# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue:

- **GitHub:** use **Report a vulnerability** on this repository's [Security tab](https://github.com/thriftshoppin/claude-firefox-bridge/security/advisories/new).
- **Email:** cherrybuster369@gmail.com

Include what you found, how to reproduce it, and which versions are affected: the add-on version from about:addons, and the plugin version. You'll get a reply as soon as possible. Fixes are recorded in [SECURITY-AUDIT.md](SECURITY-AUDIT.md) and [CHANGELOG.md](CHANGELOG.md).

## Supported versions

Only the latest release of the Claude MCP Connect add-on and the Firefox MCP Connect plugin get security fixes.

## Security model in brief

- The bridge listens only on 127.0.0.1 and accepts only Firefox add-on origins.
- The add-on and the bridge log in with a challenge-response based on your connection code. The code is never sent, and the add-on obeys only a bridge that proves it knows it.
- Typing into password, payment-card and one-time-code fields is refused wherever they can be detected.
- Nothing is sent to the project's authors or any third party. See the [privacy policy](https://thriftshoppin.github.io/claude-firefox-bridge/privacy).
