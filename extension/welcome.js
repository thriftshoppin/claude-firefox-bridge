"use strict";
const $ = (id) => document.getElementById(id);
let code = "";

function show(token) {
  code = token || "";
  $("code").textContent = code ? `${code.slice(0, 6)}…${code.slice(-4)}` : "creating a code…";
  $("code").title = code ? "The full code is copied when you click Copy." : "";
}

async function copy(auto) {
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    $("status").textContent = auto ? "Copied to your clipboard. Paste it into Claude." : "Copied!";
  } catch (e) {
    $("status").textContent = auto ? "Click Copy, then paste the code into Claude." : "Copy didn't work. Use the toolbar icon's Copy button instead.";
  }
}

// The background page creates the code on first run; it may land a moment after this page opens.
async function init() {
  const { token = "" } = await browser.storage.local.get("token");
  show(token);
  if (token) copy(true);
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.token && changes.token.newValue) {
    const first = !code;
    show(changes.token.newValue);
    if (first) copy(true);
  }
});

$("copy").addEventListener("click", () => copy(false));
init();
