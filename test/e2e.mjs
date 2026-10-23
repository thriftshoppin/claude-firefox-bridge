// Live round trip: MCP client -> bridge -> Firefox extension (loaded via web-ext run in a throwaway profile).
// Usage: node e2e.mjs <extensionDir> <profileDir> <outDir>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, execSync } from "node:child_process";
import { writeFileSync, createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";

const [extDir, profDir, outDir] = process.argv.slice(2);
const bridge = fileURLToPath(new URL("../server/bridge.js", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, cond, info = "") => { results.push({ name, ok: !!cond, info }); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${info ? "  — " + info : ""}`); };
const txt = (r) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

const client = new Client({ name: "e2e", version: "1" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [bridge],
  env: { ...process.env, FF_BRIDGE_PORT: "18766", FF_BRIDGE_TOKEN: "e2e-test-token-not-real" }, stderr: "inherit" }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 20000 });
  console.log(`> ${name} ${JSON.stringify(args)}\n  ${(r.isError ? "ERR " : "") + txt(r).replace(/\n/g, "\n  ").slice(0, 600)}`);
  return r;
};

const webExtBin = (await import("node:path")).join(process.env.APPDATA, "npm", "node_modules", "web-ext", "bin", "web-ext.js");
const wx = spawn(process.execPath, [webExtBin, "run", "--source-dir", extDir, "--firefox-profile", profDir, "--no-reload",
  "--firefox", "C:/Program Files/Mozilla Firefox/firefox.exe", "--start-url", "about:blank", "--verbose",
  // Pipe the extension's background console to stdout (same messages about:debugging -> Inspect shows).
  "--pref", "devtools.console.stdout.chrome=true", "--pref", "devtools.console.stdout.content=true"],
  { stdio: ["ignore", "pipe", "pipe"] });
const wxLog = createWriteStream(`${outDir}/web-ext.log`);
wx.stdout.pipe(wxLog); wx.stderr.pipe(wxLog);
wx.on("exit", (code) => console.log(`[web-ext exited with code ${code}]`));
const cleanup = () => {
  try { execSync(`taskkill /PID ${wx.pid} /T /F`, { stdio: "ignore" }); } catch {}
  // web-ext's Firefox can outlive its parent; only instances started with web-ext's debugger flag are touched.
  try { execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='firefox.exe'\\" | Where-Object { $_.CommandLine -match 'start-debugger-server' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F }"`, { stdio: "ignore" }); } catch {}
};

// Watchdogs: connect phase capped at 20 s (above); whole run capped so it can never hang.
const OVERALL_MS = 120000;
const watchdog = setTimeout(() => {
  console.log(`FAIL  overall timeout after ${OVERALL_MS / 1000}s — see ${outDir}/web-ext.log`);
  cleanup(); process.exit(2);
}, OVERALL_MS);
try {
  let r, connected = false;
  const connectStart = Date.now();
  while (!connected && Date.now() - connectStart < 20000) {
    r = await client.callTool({ name: "tabs_list", arguments: {} });
    connected = !r.isError; if (!connected) await sleep(500);
  }
  check("extension connected to bridge", connected, connected ? "" : txt(r));
  if (!connected) throw new Error("no connection");

  r = await call("tabs_list");
  check("tabs_list", !r.isError && Array.isArray(JSON.parse(txt(r))));

  r = await call("tab_open", { url: "https://duckduckgo.com" });
  const tabId = JSON.parse(txt(r)).tabId;
  check("tab_open duckduckgo", !r.isError && Number.isInteger(tabId), `tabId ${tabId}`);
  await sleep(1500);

  r = await call("screenshot", { tabId });
  const img = r.content.find((c) => c.type === "image");
  const png = Buffer.from(img.data, "base64");
  writeFileSync(`${outDir}/ddg.png`, png);
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  const [, vw, vh] = txt(r).match(/viewport (\d+)x(\d+)/).map(Number);
  check("screenshot size == viewport", w === vw && h === vh, `png ${w}x${h}, viewport ${vw}x${vh}`);

  r = await call("find", { query: "search", tabId });
  const lines = txt(r).split("\n");
  const inputLine = lines.find((l) => /\] (textbox|searchbox|combobox)/.test(l));
  const ref = inputLine && inputLine.match(/\[(r\d+)\]/)[1];
  check("find 'search' returns the search box", !!ref, inputLine);

  r = await call("click", { ref, tabId });
  check("click search box", !r.isError);
  r = await call("type", { text: "cyberpunk 2077", tabId });
  check("type into focused box", !r.isError);
  r = await call("key", { keys: "Enter", tabId });
  check("key Enter", !r.isError);
  let found = false;
  for (let i = 0; i < 15 && !found; i++) {
    await sleep(1000);
    r = await client.callTool({ name: "get_page_text", arguments: { tabId, max_chars: 4000 } });
    found = !r.isError && txt(r).includes("Cyberpunk");
  }
  const tabsNow = JSON.parse(txt(await client.callTool({ name: "tabs_list", arguments: {} })));
  check("get_page_text contains 'Cyberpunk'", found, tabsNow.find((t) => t.tabId === tabId)?.url);

  r = await call("read_page", { tabId });
  check("read_page interactive tree", !r.isError && /\[r\d+\] link/.test(txt(r)), `${txt(r).split("\n").length} lines`);

  r = await call("scroll", { direction: "down", tabId });
  check("scroll down", !r.isError && /scrollY [1-9]/.test(txt(r)));

  r = await call("screenshot", { tabId });
  writeFileSync(`${outDir}/ddg-results.png`, Buffer.from(r.content[0].data, "base64"));

  // Test 4: password refusal
  r = await call("navigate", { url: "https://the-internet.herokuapp.com/login", tabId });
  r = await call("find", { query: "password", tabId });
  const pw = txt(r).split("\n").find((l) => /textbox\[password\]/.test(l));
  const pwRef = pw && pw.match(/\[(r\d+)\]/)[1];
  r = await call("type", { text: "hunter2", ref: pwRef, tabId });
  check("type into password field refused (by ref)", r.isError && /password\/payment fields is disabled/.test(txt(r)));
  await call("click", { ref: pwRef, tabId });
  r = await call("type", { text: "hunter2", tabId });
  check("type into focused password field refused", r.isError && /password\/payment fields is disabled/.test(txt(r)));
  r = await call("key", { keys: "a", tabId });
  check("single-char key into password field refused", r.isError);

  r = await call("navigate", { url: "back", tabId });
  check("navigate back", !r.isError && /duckduckgo/.test(txt(r)));

  r = await call("tab_close", { tabId });
  r = await client.callTool({ name: "tabs_list", arguments: {} });
  check("tab_close", !JSON.parse(txt(r)).some((t) => t.tabId === tabId));

  r = await call("navigate", { url: "about:config" });
  r = await call("get_page_text", {});
  check("privileged page refused", r.isError && /privileged/.test(txt(r)));

  // Test 5: kill switch. The test copy maps tab_select(-999) to storage.local.set({enabled:false}),
  // the exact write the popup toggle performs.
  const t0 = Date.now();
  await client.callTool({ name: "tab_select", arguments: { tabId: -999 } });
  let off = false;
  while (!off && Date.now() - t0 < 5000) {
    r = await client.callTool({ name: "tabs_list", arguments: {} });
    off = r.isError && /isn't connected|not connected/.test(txt(r)); if (!off) await sleep(50);
  }
  const dt = Date.now() - t0;
  check("toggle OFF disconnects within 2 s", off && dt <= 2000, `${dt} ms`);
  await sleep(3000);
  r = await client.callTool({ name: "tabs_list", arguments: {} });
  check("stays disconnected while OFF", r.isError);
} catch (e) { check("e2e run", false, e.message); }
finally { cleanup(); await client.close().catch(() => {}); }
const failed = results.filter((x) => !x.ok).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
