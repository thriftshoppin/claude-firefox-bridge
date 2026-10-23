"use strict";
const $ = (id) => document.getElementById(id);
const flash = (id, text) => { $(id).textContent = text; setTimeout(() => { $(id).textContent = ""; }, 2500); };

async function load() {
  const { token = "", port = 8765 } = await browser.storage.local.get(["token", "port"]);
  $("token").value = token;
  $("port").value = port;
}
load();

$("show").addEventListener("click", () => {
  const hidden = $("token").type === "password";
  $("token").type = hidden ? "text" : "password";
  $("show").textContent = hidden ? "Hide" : "Show";
});

$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("token").value); flash("codemsg", "Copied!"); }
  catch (e) { $("token").type = "text"; $("token").select(); flash("codemsg", "Press Ctrl+C to copy."); }
});

$("newcode").addEventListener("click", async () => {
  if (!confirm("Create a new connection code? Claude stops connecting until you paste the new code into it.")) return;
  const res = await browser.runtime.sendMessage({ type: "new-code" });
  $("token").value = res.token;
  flash("codemsg", "New code created. Copy it into Claude.");
});

$("save").addEventListener("click", async () => {
  const token = $("token").value.trim();
  const port = parseInt($("port").value, 10) || 8765;
  await browser.storage.local.set({ token, port });
  flash("msg", "Saved.");
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.token) $("token").value = changes.token.newValue || "";
});
