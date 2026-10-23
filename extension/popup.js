"use strict";
const $ = (id) => document.getElementById(id);

async function refresh() {
  const st = await browser.runtime.sendMessage({ type: "status" }).catch(() => null);
  const s = $("status");
  if (!st) { s.textContent = "unknown"; s.className = "off"; return; }
  $("enabled").checked = st.enabled;
  if (!st.enabled) { s.textContent = "OFF"; s.className = "off"; }
  else if (st.connected) { s.textContent = `Connected (port ${st.port})`; s.className = "on"; }
  else { s.textContent = `Waiting for Claude (port ${st.port})`; s.className = "wait"; }
  $("err").textContent = !st.hasToken ? "No token set. Open Options." : (st.lastError || "");
  $("src").textContent = st.configSource && st.configSource !== "none" ? `Settings from: ${st.configSource}` : "";

  const { audit = [] } = await browser.storage.local.get("audit");
  const ol = $("audit");
  ol.textContent = "";
  for (const e of audit.slice(-20).reverse()) {
    const li = document.createElement("li");
    const t = document.createElement("span"); t.className = "t"; t.textContent = new Date(e.time).toLocaleTimeString() + " ";
    const c = document.createElement("span"); c.className = "c"; c.textContent = e.cmd + " ";
    const sm = document.createElement("span"); sm.textContent = (e.summary || "") + (e.url ? `  @ ${e.url}` : "");
    li.append(t, c, sm);
    ol.append(li);
  }
  if (!audit.length) ol.textContent = "No actions yet.";
}

$("enabled").addEventListener("change", async (ev) => {
  await browser.storage.local.set({ enabled: ev.target.checked });
  setTimeout(refresh, 300);
});
$("copy").addEventListener("click", async () => {
  const { token = "" } = await browser.storage.local.get("token");
  if (!token) { $("copied").textContent = "No code yet"; return; }
  try {
    await navigator.clipboard.writeText(token);
    $("copied").textContent = "Copied!";
  } catch (e) {
    $("copied").textContent = "Copy failed. Use Options.";
  }
  setTimeout(() => { $("copied").textContent = ""; }, 3000);
});
$("opts").addEventListener("click", (e) => { e.preventDefault(); browser.runtime.openOptionsPage(); window.close(); });

refresh();
setInterval(refresh, 1000);
