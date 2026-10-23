---
title: MCP Connect privacy policy
permalink: /privacy
---

# Privacy policy: Claude MCP Connect and Firefox MCP Connect

_Last updated: October 23, 2026_

MCP Connect is two pieces of software that run on your own computer: the **Claude MCP Connect** add-on for Firefox, and the **Firefox MCP Connect** plugin or desktop extension for Claude, which runs a small local program called the bridge. This policy covers both. MCP Connect is an independent community project, not affiliated with Anthropic or Mozilla.

## The short version

MCP Connect collects nothing and sends nothing to its authors or to any third party. It has no servers, analytics, telemetry, ads or tracking. Everything happens on your computer, between the Claude app you use and your Firefox.

## What MCP Connect handles, and where it goes

When you ask Claude to use your browser, Claude sends commands such as "open this page" or "click this button" to the bridge. The bridge passes them to the add-on over a connection on your own computer (127.0.0.1), and the add-on carries them out in Firefox. Results go back the same way to Claude. These results can include tab titles and addresses, page text, screenshots, and the elements on a page.

- **To Claude:** results go to the Claude app that asked for them, and from there to Anthropic as part of your conversation, the same as anything else you share with Claude. Anthropic's handling of your conversations is covered by [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy). Ask Claude to use your browser only for pages you're comfortable sharing in a conversation.
- **To anyone else:** nothing. MCP Connect doesn't send data to its authors, to Mozilla, or to any other service.

## What is stored, and where

All of it stays on your computer:

- **Connection code:** a random code the add-on creates so that only your Claude can connect. The add-on keeps it in Firefox's extension storage. Claude keeps its copy in your Claude settings, where the plugin settings mark it as sensitive so Claude stores it in your system's secure credential store.
- **Settings:** the port number and the on/off switch, in Firefox's extension storage.
- **Action log:** the add-on records the last 300 actions Claude took (time, action, page address and a short summary) so you can review them in the add-on's popup. The log never leaves your computer. You can clear it by removing the add-on.
- **The bridge stores nothing.** It writes no files and keeps nothing after Claude closes it.

## Retention and deletion

Data stays only as long as the add-on is installed. Removing the add-on from Firefox deletes its connection code, settings and action log. Removing the plugin or desktop extension from Claude deletes Claude's copy of the code.

## Sensitive fields

MCP Connect refuses to type into password, credit-card and one-time-code fields, so Claude can't enter those for you.

## Children

MCP Connect isn't directed at children and collects no personal information from anyone.

## Changes

Changes to this policy are published here and in the project's GitHub repository, with a new "Last updated" date.

## Contact

Questions or concerns: open an issue at <https://github.com/thriftshoppin/claude-firefox-bridge/issues>, or email TODO-CONTACT-EMAIL.
