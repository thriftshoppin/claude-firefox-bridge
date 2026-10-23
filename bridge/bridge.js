#!/usr/bin/env node
// Claude Firefox Bridge: stdio MCP server + localhost WebSocket for the Firefox extension.
// stdout is reserved for MCP traffic. All logging goes to stderr.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";

const log = (...a) => console.error("[ff-bridge]", ...a);
console.log = console.error; // safety: never let a stray console.log corrupt stdout
console.info = console.error;

const PORT = parseInt(process.env.FF_BRIDGE_PORT || "8765", 10);
const TOKEN = process.env.FF_BRIDGE_TOKEN || "";
const CALL_TIMEOUT_MS = 30_000;
const NOT_CONNECTED = "Firefox extension not connected. Is Firefox open and the bridge toggled ON in its toolbar?";

if (!TOKEN) log("WARNING: FF_BRIDGE_TOKEN is empty; all extension connections will be rejected.");

// ---------------- WebSocket side ----------------
// The Claude desktop app can start several copies of this server at once (one for chats, one for
// Cowork and Code sessions). The first copy to bind the port is the PRIMARY: it owns the extension
// connection. Later copies join the primary as RELAY clients and send their calls through it.
// If the primary exits, a relay takes over the port and the extension reconnects to it.
let wss = null;        // primary: listening server
let ext = null;        // primary: authenticated extension socket
let upstream = null;   // relay: authenticated socket to the primary
let nextId = 1;
let retryTimer = null;
let lastNote = "";
const pending = new Map(); // id -> {resolve, reject, timer, via}

function note(msg) { if (msg !== lastNote) { lastNote = msg; log(msg); } } // log state changes once

function failPending(via, reason) {
  for (const [id, p] of pending) {
    if (p.via !== via) continue;
    clearTimeout(p.timer);
    pending.delete(id);
    p.reject(new Error(reason));
  }
}

function settle(msg) {
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  clearTimeout(p.timer);
  if (msg.ok) p.resolve(msg.result);
  else p.reject(new Error(msg.error || "Unknown extension error"));
}

function scheduleRetry(ms) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(startServer, ms);
}

function startServer() {
  if (wss || upstream) return;
  const srv = new WebSocketServer({ host: "127.0.0.1", port: PORT, maxPayload: 64 * 1024 * 1024 });
  srv.on("listening", () => {
    wss = srv;
    note(`Primary: WebSocket listening on ws://127.0.0.1:${PORT}`);
  });
  srv.on("error", (e) => {
    if (wss === srv) { log(`WebSocket server error: ${e.message}`); return; }
    try { srv.close(); } catch {}
    if (e.code === "EADDRINUSE") {
      note(`Port ${PORT} is in use; joining the running bridge as a relay.`);
      startRelay();
    } else {
      note(`WebSocket server error (${e.code || e.message}). MCP stays up; tools report not connected. Retrying.`);
      scheduleRetry(10000);
    }
  });
  srv.on("connection", onConnection);
}

function onConnection(sock, req) {
  let role = null; // "extension" | "relay"
  const authTimer = setTimeout(() => { if (!role) sock.close(4001, "auth timeout"); }, 5000);
  sock.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { sock.close(4002, "bad json"); return; }
    if (!role) {
      clearTimeout(authTimer);
      if (!(msg && msg.type === "hello" && TOKEN && msg.token === TOKEN)) {
        log("Rejected connection: bad hello/token.");
        sock.close(4003, "unauthorized");
        return;
      }
      if (msg.role === "relay") {
        role = "relay";
        sock.send(JSON.stringify({ type: "welcome" }));
        log("A second bridge copy joined as a relay.");
        return;
      }
      role = "extension";
      if (ext && ext !== sock) {
        log("New extension connection replaces the old one.");
        try { ext.close(4000, "replaced"); } catch {}
        failPending(ext, "Extension connection replaced");
      }
      ext = sock;
      sock.send(JSON.stringify({ type: "welcome" }));
      log("Extension connected from", req.socket.remoteAddress, `(settings from ${msg.configSource || "unknown"})`);
      return;
    }
    if (role === "relay") {
      if (!msg || msg.id == null || !msg.cmd) return;
      call(msg.cmd, msg.args || {}).then(
        (result) => { if (sock.readyState === 1) sock.send(JSON.stringify({ id: msg.id, ok: true, result })); },
        (e) => { if (sock.readyState === 1) sock.send(JSON.stringify({ id: msg.id, ok: false, error: e.message || String(e) })); },
      );
      return;
    }
    if (msg && msg.id != null) settle(msg);
  });
  sock.on("close", () => {
    clearTimeout(authTimer);
    if (ext === sock) {
      ext = null;
      failPending(sock, "Firefox extension disconnected");
      log("Extension disconnected.");
    }
  });
  sock.on("error", () => {});
}

function startRelay() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { maxPayload: 64 * 1024 * 1024 });
  let welcomed = false;
  ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token: TOKEN, role: "relay" })));
  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type === "welcome") {
      welcomed = true;
      upstream = ws;
      note("Relay: connected to the primary bridge.");
      return;
    }
    if (msg.id != null) settle(msg);
  });
  ws.on("close", (code) => {
    if (upstream === ws) {
      upstream = null;
      failPending(ws, "The primary bridge went away");
      note("Relay: primary bridge gone; trying to take over the port.");
    } else if (code === 4003) {
      note(`Port ${PORT} is held by something that rejected our token. Tools report not connected; retrying.`);
    }
    scheduleRetry(welcomed ? 300 : 3000);
  });
  ws.on("error", () => {});
}

startServer();

function call(cmd, args = {}) {
  return new Promise((resolve, reject) => {
    const via = wss ? ext : upstream;
    if (!via || via.readyState !== 1) return reject(new Error(NOT_CONNECTED));
    const id = nextId++;
    const ms = via === upstream ? CALL_TIMEOUT_MS + 5000 : CALL_TIMEOUT_MS; // relay waits a bit longer than the primary
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out after ${ms / 1000}s waiting for Firefox (${cmd})`));
    }, ms);
    pending.set(id, { resolve, reject, timer, via });
    via.send(JSON.stringify({ id, cmd, args }));
  });
}

// ---------------- MCP side ----------------
const server = new McpServer({ name: "firefox", version: "1.0.0" });

const text = (t) => ({ content: [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t, null, 2) }] });
const err = (e) => ({ content: [{ type: "text", text: `Error: ${e.message || e}` }], isError: true });

function tool(name, description, shape, handler) {
  server.registerTool(name, { description, inputSchema: shape }, async (args) => {
    try { return await handler(args || {}); } catch (e) { return err(e); }
  });
}
const passthrough = (cmd) => async (args) => text(await call(cmd, args));

const tabId = z.number().int().optional().describe("Tab id; defaults to the active tab");

tool("tabs_list", "List open Firefox tabs.", {}, passthrough("tabs_list"));
tool("tab_open", "Open a new tab at a URL and make it active.", { url: z.string() }, passthrough("tab_open"));
tool("tab_select", "Activate a tab (and focus its window).", { tabId: z.number().int() }, passthrough("tab_select"));
tool("tab_close", "Close a tab.", { tabId: z.number().int() }, passthrough("tab_close"));
tool("navigate", "Navigate a tab to a URL, or 'back' / 'forward'. Waits for load (max 15 s).",
  { url: z.string().describe("URL, or 'back' / 'forward'"), tabId }, passthrough("navigate"));
tool("screenshot", "Screenshot the visible viewport. Image pixels equal CSS pixels, so coordinates can be used directly with click/scroll.",
  { tabId }, async (args) => {
    const r = await call("screenshot", args);
    return { content: [
      { type: "image", data: r.data, mimeType: "image/png" },
      { type: "text", text: `viewport ${r.width}x${r.height} CSS px (tabId ${r.tabId})` },
    ] };
  });
tool("read_page", "Compact tree of visible page elements with refs usable by click/type/form_input.",
  { tabId, filter: z.enum(["interactive", "all"]).optional() }, passthrough("read_page"));
tool("get_page_text", "Visible text of the page, whitespace collapsed.",
  { tabId, max_chars: z.number().int().positive().optional() }, passthrough("get_page_text"));
tool("find", "Find elements whose text, aria-label, placeholder, title, alt or name matches the query (case-insensitive).",
  { query: z.string(), tabId }, passthrough("find"));
tool("click", "Click an element by ref, or at viewport coordinates x,y (CSS px).",
  { ref: z.string().optional(), x: z.number().optional(), y: z.number().optional(),
    button: z.enum(["left", "right"]).optional(), double: z.boolean().optional(), tabId }, passthrough("click"));
tool("type", "Type text into the element with ref, or into the focused element.",
  { text: z.string(), ref: z.string().optional(), tabId }, passthrough("type"));
tool("key", "Press a key or combo, e.g. Enter, Tab, Escape, ctrl+a, ArrowDown. Space-separate several.",
  { keys: z.string(), tabId }, passthrough("key"));
tool("scroll", "Scroll the page or the element at x,y. amount is in steps of 100 px.",
  { direction: z.enum(["up", "down", "left", "right"]), amount: z.number().optional(),
    x: z.number().optional(), y: z.number().optional(), tabId }, passthrough("scroll"));
tool("form_input", "Set a select, checkbox or radio value by ref.",
  { ref: z.string(), value: z.union([z.string(), z.boolean(), z.number()]), tabId }, passthrough("form_input"));
tool("wait", "Wait up to 10 seconds.", { seconds: z.number().min(0).max(10) }, async ({ seconds }) => {
  await new Promise((r) => setTimeout(r, seconds * 1000));
  return text(`waited ${seconds}s`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
log("MCP server 'firefox' ready on stdio.");

const shutdown = () => { try { wss && wss.close(); } catch {} process.exit(0); };
process.stdin.on("end", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
