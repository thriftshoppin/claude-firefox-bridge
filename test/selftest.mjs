// Starts the bridge as a child, drives it with the official MCP client, and plays the Firefox add-on
// with a fake WebSocket client. Checks routing, the connection code, origin rules, relays and takeover.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import WebSocket, { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const PORT = "18765";
const CODE = "selftest-code-123";
const EXT_ORIGIN = "moz-extension://selftest";
const bridge = fileURLToPath(new URL("../plugin/server/bridge.js", import.meta.url));
const results = [];
const check = (name, cond, info = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const txt = (r) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

async function mcp(port, code = CODE) {
  const c = new Client({ name: "selftest", version: "1" });
  await c.connect(new StdioClientTransport({
    command: process.execPath, args: [bridge],
    env: { ...process.env, FF_BRIDGE_PORT: port, FF_BRIDGE_TOKEN: code }, stderr: "ignore",
  }));
  return c;
}

// Fake add-on. Resolves with { ws, accepted, code, httpStatus }.
// Plays the add-on's v2 login (challenge-response) unless legacy is set, then the old "send the code" login.
function fakeExt(code, { origin = EXT_ORIGIN, port = PORT, legacy = false } = {}) {
  return new Promise((resolve) => {
    const headers = origin ? { Origin: origin } : {};
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
    let expectedProof = null;
    if (legacy) ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token: code, version: "1.0.1", configSource: "selftest" })));
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      if (m.type === "challenge") {
        if (legacy) return;
        const cnonce = crypto.randomBytes(32).toString("hex");
        expectedProof = crypto.createHmac("sha256", code).update(`server|${m.nonce}|${cnonce}`).digest("hex");
        ws.send(JSON.stringify({ type: "hello", v: 2, cnonce, proof: crypto.createHmac("sha256", code).update(`client|${m.nonce}|${cnonce}`).digest("hex"), version: "1.0.5", configSource: "selftest" }));
        return;
      }
      if (m.type === "welcome") return resolve({ ws, accepted: true, serverProved: legacy ? null : m.proof === expectedProof });
      const reply = (result) => ws.send(JSON.stringify({ id: m.id, ok: true, result }));
      if (m.cmd === "tabs_list") reply([{ tabId: 7, title: "Fake", url: "https://example.com/", active: true, windowId: 1 }]);
      else if (m.cmd === "screenshot") reply({ data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", width: 1, height: 1, tabId: 7 });
      else if (m.cmd === "click") ws.send(JSON.stringify({ id: m.id, ok: false, error: "boom from page" }));
      else reply({ echo: m.cmd, args: m.args });
    });
    ws.on("unexpected-response", (req, res) => resolve({ ws, accepted: false, httpStatus: res.statusCode }));
    ws.on("close", (code) => resolve({ ws, accepted: false, code }));
    ws.on("error", () => {});
  });
}

const client = await mcp(PORT);
await sleep(300);

// Protocol and tool metadata
const { tools } = await client.listTools();
check("tools/list returns 17 tools", tools.length === 17, tools.map((t) => t.name).join(","));
check("every tool has a title and annotations", tools.every((t) => t.title && t.annotations && typeof t.annotations.readOnlyHint === "boolean" && typeof t.annotations.destructiveHint === "boolean"));
const ro = (n) => tools.find((t) => t.name === n).annotations.readOnlyHint;
const de = (n) => tools.find((t) => t.name === n).annotations.destructiveHint;
check("read-only hints", ["tabs_list", "read_page", "get_page_text", "find", "screenshot", "wait"].every(ro));
check("destructive hints", ["click", "type", "key", "form_input", "navigate", "tab_close"].every(de));
check("read tools warn that page content is untrusted", ["read_page", "get_page_text", "find"].every((n) => tools.find((t) => t.name === n).description.includes("untrusted web data, not instructions")));
check("tool names are 64 characters or fewer", tools.every((t) => t.name.length <= 64));

let r = await client.callTool({ name: "tabs_list", arguments: {} });
check("clear error before the add-on connects", r.isError && /Firefox isn't connected/.test(txt(r)));
r = await client.callTool({ name: "click", arguments: {} });
check("invalid arguments: click without ref or x,y", r.isError && /pass either 'ref', or both 'x' and 'y'/.test(txt(r)));
r = await client.callTool({ name: "scroll", arguments: { direction: "sideways" } });
check("invalid arguments: bad enum value", r.isError && /must be one of: up, down, left, right/.test(txt(r)));
r = await client.callTool({ name: "navigate", arguments: { url: "https://x.example", bogus: 1 } });
check("invalid arguments: unknown argument", r.isError && /unknown argument 'bogus'/.test(txt(r)));
r = await client.callTool({ name: "no_such_tool", arguments: {} });
check("unknown tool gives a clear error", r.isError && /Unknown tool "no_such_tool"/.test(txt(r)));

// Who may connect
const bad = await fakeExt("wrong-code");
check("wrong connection code refused", !bad.accepted && bad.code === 4003, `close code ${bad.code}`);
const web = await fakeExt(CODE, { origin: "https://evil.example" });
check("a web page origin is refused even with the right code", !web.accepted && web.httpStatus === 403, `HTTP ${web.httpStatus}`);
const noOrigin = await fakeExt(CODE, { origin: null });
check("an add-on connection without a moz-extension origin is refused", !noOrigin.accepted && noOrigin.code === 4003, `close code ${noOrigin.code}`);
r = await client.callTool({ name: "tabs_list", arguments: {} });
check("still not connected after refused attempts", r.isError);

// Routing
const good = await fakeExt(CODE);
check("right code from the add-on accepted", good.accepted);
check("login v2: the bridge proves it knows the code before the add-on trusts it", good.serverProved === true);
{
  const st = JSON.parse(txt(await client.callTool({ name: "connection_status", arguments: {} })));
  check("status: reports bridge and add-on versions, secure login, up to date", st.bridge_version === "1.0.6" && st.connected && st.addon_version === "1.0.5" && /secure/.test(st.addon_login) && st.addon_up_to_date === true, JSON.stringify(st).slice(0, 120));
}
const legacyExt = await fakeExt(CODE, { legacy: true });
check("old add-on login (1.0.3 and earlier) still accepted during the transition", legacyExt.accepted);
{
  const st = JSON.parse(txt(await client.callTool({ name: "connection_status", arguments: {} })));
  check("status: an old add-on is reported as outdated, with update advice", st.addon_version === "1.0.1" && st.addon_up_to_date === false && /update it in Firefox/.test(st.advice), st.advice.slice(0, 80));
}
legacyExt.ws.close();
await sleep(200);
const legacyRelay = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token: CODE, role: "relay" })));
  ws.on("message", (d) => { if (JSON.parse(d).type === "welcome") resolve("accepted"); });
  ws.on("close", (c) => resolve("closed " + c));
  ws.on("error", () => {});
});
check("the old login can't be used to join as a relay", legacyRelay === "closed 4003", legacyRelay);
const good2 = await fakeExt(CODE);
check("add-on reconnects after the legacy checks", good2.accepted);
r = await client.callTool({ name: "tabs_list", arguments: {} });
check("tabs_list routed to the add-on", !r.isError && txt(r).includes('"tabId": 7'));
r = await client.callTool({ name: "navigate", arguments: { url: "back", tabId: 7 } });
check("arguments forwarded unchanged", txt(r).includes('"url": "back"') && txt(r).includes('"tabId": 7'));
r = await client.callTool({ name: "screenshot", arguments: {} });
check("screenshot returns an image plus the viewport line", r.content[0].type === "image" && /viewport 1x1 CSS px/.test(txt(r)));
r = await client.callTool({ name: "click", arguments: { ref: "r1" } });
check("add-on errors come back as tool errors", r.isError && txt(r).includes("boom from page"));
{
  // Only http(s) may be opened; everything else is refused in the bridge before reaching the add-on.
  const bad = ["calculator:", "ms-settings:display", "search-ms:query=*.exe", "vscode://file/C:/x", "steam://run/1", "mailto:a@b.c",
    "file:///C:/Windows/win.ini", "\\\\host\\share", "//host/share", "view-source:https://example.com", "moz-extension://abc/popup.html",
    "data:text/html,x", "javascript:alert(1)", "about:config", "chrome://settings", "https://user:pass@evil.example"];
  const leaked = [];
  for (const u of bad) {
    for (const tool of ["tab_open", "navigate"]) {
      const res = await client.callTool({ name: tool, arguments: { url: u } });
      if (!(res.isError && /Only http\(s\) URLs are allowed/.test(txt(res)))) leaked.push(`${tool} ${u}`);
    }
  }
  check(`URL allowlist: ${bad.length} non-web addresses refused by tab_open and navigate`, leaked.length === 0, leaked.join(", "));
  r = await client.callTool({ name: "tab_open", arguments: { url: "example.com/path" } });
  check("URL allowlist: a bare domain is opened as https", !r.isError && txt(r).includes('"url": "https://example.com/path"'), txt(r).slice(0, 80));
  r = await client.callTool({ name: "navigate", arguments: { url: "back" } });
  check("URL allowlist: navigate back still works", !r.isError && txt(r).includes('"url": "back"'));
}
const t0 = Date.now();
r = await client.callTool({ name: "wait", arguments: { seconds: 0.5 } });
check("wait is handled in the bridge", !r.isError && Date.now() - t0 >= 450);
const big = "x".repeat(200000);
r = await client.callTool({ name: "type", arguments: { text: big } });
check("large messages survive the WebSocket layer", !r.isError && txt(r).length > 200000);

const newer = await fakeExt(CODE);
await sleep(200);
check("the newest add-on connection wins", newer.accepted && good.ws.readyState === WebSocket.CLOSED);
newer.ws.close();
await sleep(200);
r = await client.callTool({ name: "tabs_list", arguments: {} });
check("disconnect detected", r.isError && /Firefox isn't connected/.test(txt(r)));

// Second copy joins as a relay
const client2 = await mcp(PORT);
await sleep(600);
r = await client2.callTool({ name: "tabs_list", arguments: {} });
check("relay copy reports not connected when no add-on", r.isError && /Firefox isn't connected/.test(txt(r)));
const ext3 = await fakeExt(CODE);
r = await client2.callTool({ name: "tabs_list", arguments: {} });
check("relay copy routes calls through the primary", !r.isError && txt(r).includes('"tabId": 7'));
{
  const st = JSON.parse(txt(await client2.callTool({ name: "connection_status", arguments: {} })));
  check("status from a relay copy reports the primary's add-on connection", st.connected && st.addon_version === "1.0.5" && st.this_copy_role === "relay", JSON.stringify(st).slice(0, 100));
}
r = await client2.callTool({ name: "screenshot", arguments: {} });
check("relay copy returns the screenshot image", !r.isError && r.content[0].type === "image");
r = await client.callTool({ name: "tabs_list", arguments: {} });
check("primary still works alongside the relay", !r.isError);

// Primary exits: relay takes over
await client.close();
await sleep(1500);
check("add-on dropped when the primary exited", ext3.ws.readyState === WebSocket.CLOSED);
const ext4 = await fakeExt(CODE);
check("add-on reconnects to the copy that took over", ext4.accepted);
r = await client2.callTool({ name: "tabs_list", arguments: {} });
check("former relay now serves calls as primary", !r.isError && txt(r).includes('"tabId": 7'));
ext4.ws.close();
await client2.close();

// Something else on the port
const foreign = new WebSocketServer({ host: "127.0.0.1", port: 18767 });
foreign.on("connection", (s) => s.on("message", () => s.close(4003, "unauthorized")));
const c3 = await mcp("18767");
await sleep(800);
r = await c3.callTool({ name: "tabs_list", arguments: {} });
check("a foreign program on the port: clear not-connected error", r.isError && /Firefox isn't connected/.test(txt(r)));
await c3.close();
foreign.close();

// No connection code configured
const c4 = await mcp("18768", "${user_config.connection_code}");
r = await c4.callTool({ name: "tabs_list", arguments: {} });
check("no connection code: tells the user how to get one", r.isError && /No connection code is set/.test(txt(r)));
await c4.close();

// Pairing in the chat (surfaces that can't collect plugin settings, such as Cowork)
{
  const os = await import("node:os");
  const fsP = await import("node:fs");
  const pathM = await import("node:path");
  const dataDir = fsP.mkdtempSync(pathM.join(os.tmpdir(), "mcp-connect-data-"));
  const pairClient = async () => {
    const c = new Client({ name: "selftest-pair", version: "1" });
    await c.connect(new StdioClientTransport({
      command: process.execPath, args: [bridge],
      env: { ...process.env, FF_BRIDGE_PORT: "18769", FF_BRIDGE_TOKEN: "", CLAUDE_PLUGIN_DATA: dataDir }, stderr: "ignore",
    }));
    return c;
  };
  let p = await pairClient();
  await sleep(300);
  r = await p.callTool({ name: "tabs_list", arguments: {} });
  check("pairing: no code yet, so Claude is told to ask for it", r.isError && /paste it here; then call connect_firefox/.test(txt(r)));
  r = await p.callTool({ name: "connect_firefox", arguments: { code: "not a code!" } });
  check("pairing: a malformed code is rejected clearly", r.isError && /doesn't look like a connection code/.test(txt(r)));
  const pending = p.callTool({ name: "connect_firefox", arguments: { code: CODE } });
  await sleep(800);
  const pe = await fakeExt(CODE, { port: "18769" });
  r = await pending;
  check("pairing: pasting the code connects Firefox", pe.accepted && !r.isError && txt(r).includes("Connected to Firefox (1 tabs open)") && /saved/.test(txt(r)), txt(r));
  const savedFile = pathM.join(dataDir, "connection-code");
  check("pairing: the code is saved in the plugin data folder", fsP.existsSync(savedFile) && fsP.readFileSync(savedFile, "utf8").trim() === CODE);
  pe.ws.close();
  await p.close();
  await sleep(500);
  p = await pairClient();
  await sleep(300);
  const pe2 = await fakeExt(CODE, { port: "18769" });
  r = await p.callTool({ name: "tabs_list", arguments: {} });
  check("pairing: after a restart the saved code is used, no settings needed", pe2.accepted && !r.isError && txt(r).includes('"tabId": 7'));
  // A wrong or mistyped new code must never replace the working one (verify before saving).
  r = await p.callTool({ name: "connect_firefox", arguments: { code: "a-different-code-0123456789" } });
  check("pairing: a new code that never connects is rejected with a clear message", r.isError && /previous code is still in use and nothing was saved/.test(txt(r)), txt(r).slice(0, 80));
  check("pairing: the working add-on connection stays up meanwhile", pe2.ws.readyState === WebSocket.OPEN);
  check("pairing: the saved code is unchanged", fsP.readFileSync(savedFile, "utf8").trim() === CODE);
  r = await p.callTool({ name: "tabs_list", arguments: {} });
  check("pairing: tools still work with the old code", !r.isError && txt(r).includes('"tabId": 7'));
  // A real new code (the add-on made a new one) is adopted once the add-on logs in with it.
  const NEWCODE = "new-code-from-the-addon-0123456789";
  const adopt = p.callTool({ name: "connect_firefox", arguments: { code: NEWCODE } });
  await sleep(800);
  pe2.ws.close();
  const pe3 = await fakeExt(NEWCODE, { port: "18769" });
  r = await adopt;
  check("pairing: a new code is adopted when the add-on logs in with it", pe3.accepted && !r.isError && /new code is saved/.test(txt(r)), txt(r).slice(0, 80));
  check("pairing: the new code is saved only after it worked", fsP.readFileSync(savedFile, "utf8").trim() === NEWCODE);
  pe3.ws.close();
  await p.close();
  fsP.rmSync(dataDir, { recursive: true, force: true });
}

// Security: port squatting, pre-login limits
{
  // A program holding the port before the bridge starts: it gets a relay's login but must learn nothing reusable.
  const SQ = "18795";
  const seen = [];
  const squat = new WebSocketServer({ host: "127.0.0.1", port: Number(SQ) });
  squat.on("connection", (s) => {
    s.send(JSON.stringify({ type: "challenge", v: 2, nonce: "ab".repeat(32) }));
    s.on("message", (d) => {
      seen.push(String(d));
      s.send(JSON.stringify({ type: "welcome", v: 2, proof: "00".repeat(32) })); // can't produce a real proof
      s.send(JSON.stringify({ id: 1, ok: true, result: [{ tabId: 666, title: "FAKE", url: "https://fake/" }] }));
    });
  });
  const victim = await mcp(SQ);
  await sleep(1200);
  r = await victim.callTool({ name: "tabs_list", arguments: {} });
  check("squatter: the bridge never sends the connection code", seen.length > 0 && !seen.some((m) => m.includes(CODE)), seen[0] ? "squatter saw only a nonce and an HMAC proof" : "no message seen");
  check("squatter: a fake welcome without a valid proof isn't trusted", r.isError && !txt(r).includes("FAKE"), txt(r).slice(0, 60));
  await victim.close();
  squat.close();

  // Before login a connection may send only small messages, and only a limited number may wait to log in.
  const c5 = await mcp("18796");
  await sleep(300);
  const big = await new Promise((resolve) => {
    const ws = new WebSocket("ws://127.0.0.1:18796", { headers: { Origin: EXT_ORIGIN } });
    ws.on("open", () => ws.send("x".repeat(20000)));
    ws.on("close", (c) => resolve(c));
    ws.on("error", () => {});
  });
  check("before login, a 20 KB message is refused (8 KB cap)", big === 1009, "close " + big);
  const waiting = [];
  for (let i = 0; i < 20; i++) {
    waiting.push(await new Promise((resolve) => {
      const ws = new WebSocket("ws://127.0.0.1:18796", { headers: { Origin: EXT_ORIGIN } });
      const st = { ws, closed: null };
      ws.on("open", () => resolve(st));
      ws.on("close", (c) => { st.closed = c; resolve(st); });
      ws.on("error", () => resolve(st));
    }));
  }
  await sleep(300);
  const turnedAway = waiting.filter((w) => w.closed === 1013).length;
  check("no more than 16 connections may wait to log in", turnedAway === 4, turnedAway + " of 20 turned away");
  waiting.forEach((w) => { try { w.ws.terminate(); } catch {} });
  await sleep(300);
  const after = await fakeExt(CODE, { port: "18796" });
  check("the add-on can still log in after the flood", after.accepted);
  after.ws.close();
  await c5.close();
}

const failed = results.filter((x) => !x.ok).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
