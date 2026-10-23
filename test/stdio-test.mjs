// Test 1: raw JSON-RPC over stdin; every stdout line must be valid MCP JSON.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const bridge = fileURLToPath(new URL("../plugin/server/bridge.js", import.meta.url));
const child = spawn(process.execPath, [bridge], { env: { ...process.env, FF_BRIDGE_PORT: "18799", FF_BRIDGE_TOKEN: "x" } });
let buf = "", stdoutLines = [];
child.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { stdoutLines.push(buf.slice(0, i)); buf = buf.slice(i + 1); } });
child.stderr.on("data", () => {});
const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
await new Promise((r) => setTimeout(r, 800));
const before = stdoutLines.length + buf.length;
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
await new Promise((r) => setTimeout(r, 1200));
child.kill();
const msgs = stdoutLines.map((l) => JSON.parse(l)); // throws if anything non-JSON hit stdout
const init = msgs.find((m) => m.id === 1), list = msgs.find((m) => m.id === 2);
const names = list.result.tools.map((t) => t.name).sort();
const expected = ["click","connect_firefox","find","form_input","get_page_text","key","navigate","read_page","screenshot","scroll","tab_close","tab_open","tab_select","tabs_list","type","wait"];
const ok = before === 0 && init.result.serverInfo.name === "firefox" && JSON.stringify(names) === JSON.stringify(expected) && buf === "";
console.log(`stdout before initialize: ${before} bytes; server=${init.result.serverInfo.name}; tools(${names.length})=${names.join(",")}`);
console.log(ok ? "PASS" : "FAIL"); process.exit(ok ? 0 : 1);
