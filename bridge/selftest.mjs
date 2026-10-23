// Test 2: start bridge as a child, connect a fake extension over ws, confirm routing and auth.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import WebSocket from "ws";
import { fileURLToPath } from "node:url";

const PORT = "18765", TOKEN = "selftest-token-123";
const bridge = fileURLToPath(new URL("./bridge.js", import.meta.url));
const results = [];
const check = (name, cond, info = "") => { results.push({ name, ok: !!cond }); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${info ? "  — " + info : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mcp(port) {
  const c = new Client({ name: "selftest", version: "1" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [bridge], env: { ...process.env, FF_BRIDGE_PORT: port, FF_BRIDGE_TOKEN: TOKEN }, stderr: "ignore" }));
  return c;
}
const txt = (r) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

function fakeExt(token) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token })));
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      if (m.type === "welcome") return resolve({ ws, accepted: true });
      const reply = (result) => ws.send(JSON.stringify({ id: m.id, ok: true, result }));
      if (m.cmd === "tabs_list") reply([{ tabId: 7, title: "Fake", url: "https://example.com/", active: true, windowId: 1 }]);
      else if (m.cmd === "screenshot") reply({ data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", width: 1, height: 1, tabId: 7 });
      else if (m.cmd === "click") ws.send(JSON.stringify({ id: m.id, ok: false, error: "boom from page" }));
      else reply({ echo: m.cmd, args: m.args });
    });
    ws.on("close", (code) => resolve({ ws, accepted: false, code }));
    ws.on("error", () => {});
  });
}

const client = await mcp(PORT);
await sleep(300);
let r = await client.callTool({ name: "tabs_list", arguments: {} });
check("not-connected error before extension connects", r.isError && /not connected/.test(txt(r)));

const bad = await fakeExt("wrong-token");
check("wrong token rejected", !bad.accepted && bad.code === 4003, `close code ${bad.code}`);
r = await client.callTool({ name: "tabs_list", arguments: {} });
check("still not connected after bad token", r.isError);

const good = await fakeExt(TOKEN);
check("correct token accepted", good.accepted);
r = await client.callTool({ name: "tabs_list", arguments: {} });
check("tabs_list routed to extension", !r.isError && txt(r).includes('"tabId": 7'));
r = await client.callTool({ name: "navigate", arguments: { url: "back", tabId: 7 } });
check("args forwarded", txt(r).includes('"url": "back"') && txt(r).includes('"tabId": 7'));
r = await client.callTool({ name: "screenshot", arguments: {} });
check("screenshot returns image + viewport line", r.content[0].type === "image" && /viewport 1x1 CSS px/.test(txt(r)));
r = await client.callTool({ name: "click", arguments: { ref: "r1" } });
check("extension error surfaces as tool error", r.isError && txt(r).includes("boom from page"));
const t0 = Date.now(); r = await client.callTool({ name: "wait", arguments: { seconds: 0.5 } });
check("wait handled in bridge", !r.isError && Date.now() - t0 >= 450);

const newer = await fakeExt(TOKEN);
await sleep(200);
check("newest connection wins", newer.accepted && good.ws.readyState === WebSocket.CLOSED);
newer.ws.close(); await sleep(200);
r = await client.callTool({ name: "tabs_list", arguments: {} });
check("disconnect detected", r.isError && /not connected/.test(txt(r)));

// Second copy on the same port joins as a relay (the desktop app starts one per chat surface).
const client2 = await mcp(PORT);
await sleep(500);
r = await client2.callTool({ name: "tabs_list", arguments: {} });
check("relay copy: MCP stays up, reports not connected when no extension", r.isError && /not connected/.test(txt(r)));
const ext3 = await fakeExt(TOKEN);
r = await client2.callTool({ name: "tabs_list", arguments: {} });
check("relay copy routes calls through the primary to the extension", !r.isError && txt(r).includes('"tabId": 7'));
r = await client2.callTool({ name: "screenshot", arguments: {} });
check("relay copy returns screenshot image", !r.isError && r.content[0].type === "image");
r = await client.callTool({ name: "tabs_list", arguments: {} });
check("primary still works alongside the relay", !r.isError);

// Primary exits: the relay must take over the port and the extension must be able to reconnect to it.
await client.close();
await sleep(1500);
check("extension dropped when primary exited", ext3.ws.readyState === WebSocket.CLOSED);
const ext4 = await fakeExt(TOKEN);
check("extension reconnects to the copy that took over", ext4.accepted);
r = await client2.callTool({ name: "tabs_list", arguments: {} });
check("former relay now serves calls as primary", !r.isError && txt(r).includes('"tabId": 7'));
ext4.ws.close();

// Something else holding the port with a different token: tools must report not connected, not hang.
const { WebSocketServer } = await import("ws");
const foreign = new WebSocketServer({ host: "127.0.0.1", port: 18767 });
foreign.on("connection", (s) => s.on("message", () => s.close(4003, "unauthorized")));
const c3 = new Client({ name: "selftest3", version: "1" });
await c3.connect(new StdioClientTransport({ command: process.execPath, args: [bridge], env: { ...process.env, FF_BRIDGE_PORT: "18767", FF_BRIDGE_TOKEN: TOKEN }, stderr: "ignore" }));
await sleep(800);
r = await c3.callTool({ name: "tabs_list", arguments: {} });
check("foreign process on port: reports not connected", r.isError && /not connected/.test(txt(r)));
await c3.close(); foreign.close();
await client2.close();

const failed = results.filter((x) => !x.ok).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
