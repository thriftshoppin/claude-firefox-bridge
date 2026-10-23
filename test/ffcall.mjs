// Drive Firefox from a terminal through the running bridge.
// Usage: node ffcall.mjs <tool> '<json args>'     e.g. node ffcall.mjs tabs_list '{}'
// Reads the token from FF_BRIDGE_TOKEN, or from the Claude desktop config, without printing it.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function findToken() {
  if (process.env.FF_BRIDGE_TOKEN) return process.env.FF_BRIDGE_TOKEN;
  const cands = [];
  if (process.env.APPDATA) cands.push(join(process.env.APPDATA, "Claude", "claude_desktop_config.json"));
  const cd = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Claude-Data");
  if (cd && existsSync(cd)) for (const d of readdirSync(cd)) cands.push(join(cd, d, "claude_desktop_config.json"));
  for (const f of cands) {
    try { const t = JSON.parse(readFileSync(f, "utf8")).mcpServers?.firefox?.env?.FF_BRIDGE_TOKEN; if (t) return t; } catch {}
  }
  throw new Error("No token: set FF_BRIDGE_TOKEN or add the firefox server to the Claude config.");
}

const [tool, rawArgs = "{}", saveImage] = process.argv.slice(2);
if (!tool) { console.error("usage: node ffcall.mjs <tool> '<json args>' [image-out.png]"); process.exit(2); }
const client = new Client({ name: "ffcall", version: "1" });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../server/bridge.js", import.meta.url))],
  env: { ...process.env, FF_BRIDGE_TOKEN: findToken(), FF_BRIDGE_PORT: process.env.FF_BRIDGE_PORT || "8765" },
  stderr: "ignore",
}));
await new Promise((r) => setTimeout(r, 700)); // let this copy join the running bridge as a relay
const res = await client.callTool({ name: tool, arguments: JSON.parse(rawArgs) }, undefined, { timeout: 40000 });
for (const c of res.content) {
  if (c.type === "text") console.log(c.text);
  else if (c.type === "image" && saveImage) { writeFileSync(saveImage, Buffer.from(c.data, "base64")); console.log(`[image saved to ${saveImage}]`); }
}
await client.close();
process.exit(res.isError ? 1 : 0);
