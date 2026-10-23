/* Claude Firefox Bridge: background page. Keeps a WebSocket to the local bridge and runs commands. */
"use strict";

const DEFAULTS = { token: "", port: 8765, enabled: true };
const AUDIT_MAX = 300;

let settings = { ...DEFAULTS };
let ws = null;
let connected = false;
let backoff = 1000;
let reconnectTimer = null;
let lastError = "";

// ---------------- badge / status ----------------
function setBadge() {
  let text, color;
  if (!settings.enabled) { text = "OFF"; color = "#808080"; }
  else if (connected) { text = "ON"; color = "#1a9c3a"; }
  else { text = "…"; color = "#c98a00"; }
  browser.browserAction.setBadgeText({ text });
  browser.browserAction.setBadgeBackgroundColor({ color });
}

function status() {
  return {
    enabled: settings.enabled,
    connected,
    port: settings.port,
    hasToken: !!settings.token,
    configSource,
    lastError,
  };
}

// ---------------- connection ----------------
function disconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (ws) {
    const s = ws;
    ws = null;
    s.onopen = s.onmessage = s.onclose = s.onerror = null;
    try { s.close(1000, "disabled"); } catch (e) { /* ignore */ }
  }
  connected = false;
  setBadge();
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  if (!settings.enabled) return;
  reconnectTimer = setTimeout(connect, backoff);
  backoff = Math.min(backoff * 2, 10000);
}

function connect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (!settings.enabled) { setBadge(); return; }
  if (ws) return;
  if (!settings.token) { lastError = "No token set (open the add-on options)."; setBadge(); scheduleReconnect(); return; }
  let s;
  try {
    s = new WebSocket(`ws://127.0.0.1:${settings.port}`);
  } catch (e) {
    lastError = String(e);
    scheduleReconnect();
    return;
  }
  ws = s;
  s.onopen = () => s.send(JSON.stringify({ type: "hello", token: settings.token, configSource, version: browser.runtime.getManifest().version }));
  s.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.type === "welcome") {
      connected = true;
      backoff = 1000;
      lastError = "";
      setBadge();
      return;
    }
    if (msg.id != null && msg.cmd) handleRequest(s, msg);
  };
  s.onclose = (ev) => {
    if (ws !== s) return;
    ws = null;
    connected = false;
    if (ev.code === 4003) lastError = "Bridge rejected the token.";
    else if (ev.code === 4000) lastError = "Replaced by another connection.";
    setBadge();
    scheduleReconnect();
  };
  s.onerror = () => { /* failed connects are normal while Claude is closed */ };
}

let configSource = "none";

// Temporary add-ons (AutoConfig install) lose storage.local at every Firefox shutdown.
// When storage has no token, seed it from extension/local-config.json if that file exists.
async function seedFromLocalConfig() {
  try {
    const res = await fetch(browser.runtime.getURL("local-config.json"));
    if (!res.ok) return false;
    const cfg = await res.json();
    if (!cfg || typeof cfg.token !== "string" || !cfg.token) return false;
    await browser.storage.local.set({
      token: cfg.token,
      port: parseInt(cfg.port, 10) || DEFAULTS.port,
      enabled: cfg.enabled !== undefined ? !!cfg.enabled : DEFAULTS.enabled,
    });
    return true;
  } catch (e) {
    return false; // no file (e.g. the signed build): normal
  }
}

function newConnectionCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadSettings() {
  let st = await browser.storage.local.get(["token", "port", "enabled"]);
  if (st.token) configSource = ["local-config.json", "generated"].includes(configSource) ? configSource : "storage";
  else if (await seedFromLocalConfig()) {
    configSource = "local-config.json";
    st = await browser.storage.local.get(["token", "port", "enabled"]);
  } else {
    // First run: create the connection code the user copies into Claude's extension settings.
    await browser.storage.local.set({ token: newConnectionCode() });
    configSource = "generated";
    st = await browser.storage.local.get(["token", "port", "enabled"]);
  }
  settings = {
    token: st.token || "",
    port: parseInt(st.port, 10) || DEFAULTS.port,
    enabled: st.enabled !== undefined ? !!st.enabled : DEFAULTS.enabled,
  };
}

browser.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (!("token" in changes || "port" in changes || "enabled" in changes)) return;
  await loadSettings();
  disconnect();
  backoff = 1000;
  if (settings.enabled) connect();
});

// ---------------- audit log ----------------
let auditChain = Promise.resolve();
function audit(entry) {
  auditChain = auditChain.then(async () => {
    const { audit: list = [] } = await browser.storage.local.get("audit");
    list.push(entry);
    if (list.length > AUDIT_MAX) list.splice(0, list.length - AUDIT_MAX);
    await browser.storage.local.set({ audit: list });
  }).catch(() => {});
}

// ---------------- helpers ----------------
function isPrivileged(url) {
  if (!url) return true;
  if (/^(about|moz-extension|view-source|chrome|resource|jar|data):/i.test(url)) return true;
  try {
    const h = new URL(url).hostname;
    if (h === "addons.mozilla.org" || h === "accounts-static.cdn.mozilla.net" || h === "support.mozilla.org") return true;
  } catch (e) { return true; }
  return false;
}

async function resolveTab(tabId) {
  if (tabId != null) return browser.tabs.get(tabId);
  let [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) [tab] = await browser.tabs.query({ active: true });
  if (!tab) throw new Error("No active tab found.");
  return tab;
}

function waitForComplete(tabId, timeoutMs = 15000, sawLoadingInitially = false) {
  return new Promise((resolve) => {
    let sawLoading = sawLoadingInitially;
    const done = (timedOut) => {
      clearTimeout(timer);
      clearInterval(poll);
      browser.tabs.onUpdated.removeListener(onUpd);
      resolve(timedOut);
    };
    const onUpd = (id, info) => {
      if (id !== tabId) return;
      if (info.status === "loading") sawLoading = true;
      if (info.status === "complete" && sawLoading) done(false);
    };
    browser.tabs.onUpdated.addListener(onUpd);
    // Fallback poll: catches fast loads and same-document navigations.
    const started = Date.now();
    const poll = setInterval(async () => {
      try {
        const t = await browser.tabs.get(tabId);
        if (t.status === "loading") sawLoading = true;
        if (t.status === "complete" && (sawLoading || Date.now() - started > 1500)) done(false);
      } catch (e) { done(false); }
    }, 250);
    const timer = setTimeout(() => done(true), timeoutMs);
  });
}

async function pageTab(tabId) {
  const tab = await resolveTab(tabId);
  if (isPrivileged(tab.url)) throw new Error(`Refusing to act on privileged page: ${tab.url}`);
  return tab;
}

async function ensureContent(tab) {
  const [loaded] = await browser.tabs.executeScript(tab.id, { code: "!!window.__claudeBridgeLoaded", runAt: "document_start" })
    .catch((e) => { throw new Error(`Cannot access this page (${tab.url}): ${e.message}`); });
  if (!loaded) await browser.tabs.executeScript(tab.id, { file: "content.js", runAt: "document_idle" });
}

async function content(tabId, cmd, args) {
  const tab = await pageTab(tabId);
  await ensureContent(tab);
  const res = await browser.tabs.sendMessage(tab.id, { __claude: true, cmd, args }, { frameId: 0 });
  if (!res) throw new Error("No response from page.");
  if (!res.ok) throw new Error(res.error);
  return { tab, result: res.result };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- commands ----------------
const commands = {
  async tabs_list() {
    const tabs = await browser.tabs.query({});
    return tabs.map((t) => ({ tabId: t.id, title: t.title, url: t.url, active: t.active, windowId: t.windowId }));
  },

  async tab_open({ url }) {
    const t = await browser.tabs.create({ url, active: true });
    await browser.windows.update(t.windowId, { focused: true }).catch(() => {});
    const timedOut = await waitForComplete(t.id);
    const now = await browser.tabs.get(t.id);
    return { tabId: t.id, url: now.url, title: now.title, ...(timedOut ? { note: "load not complete after 15 s" } : {}) };
  },

  async tab_select({ tabId }) {
    const t = await browser.tabs.update(tabId, { active: true });
    await browser.windows.update(t.windowId, { focused: true }).catch(() => {});
    return { tabId: t.id, title: t.title, url: t.url };
  },

  async tab_close({ tabId }) {
    await browser.tabs.remove(tabId);
    return { closed: tabId };
  },

  async navigate({ url, tabId }) {
    const tab = await resolveTab(tabId);
    const target = String(url).trim();
    const wait = waitForComplete(tab.id);
    if (target === "back") await browser.tabs.goBack(tab.id);
    else if (target === "forward") await browser.tabs.goForward(tab.id);
    else {
      const u = /^[a-z][a-z0-9+.-]*:/i.test(target) ? target : `https://${target}`;
      await browser.tabs.update(tab.id, { url: u });
    }
    const timedOut = await wait;
    const now = await browser.tabs.get(tab.id);
    return { tabId: now.id, url: now.url, title: now.title, ...(timedOut ? { note: "load not complete after 15 s" } : {}) };
  },

  async screenshot({ tabId }) {
    let tab = await pageTab(tabId);
    if (!tab.active) {
      tab = await browser.tabs.update(tab.id, { active: true });
      await sleep(350);
    }
    await ensureContent(tab);
    const vp = await browser.tabs.sendMessage(tab.id, { __claude: true, cmd: "viewport", args: {} }, { frameId: 0 });
    if (!vp || !vp.ok) throw new Error((vp && vp.error) || "Could not read viewport size.");
    const { width, height } = vp.result;
    const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, width, height);
    const data = await blobToBase64(await canvas.convertToBlob({ type: "image/png" }));
    return { data, width, height, tabId: tab.id, url: tab.url };
  },
};

// Page-level commands handled by content.js
for (const c of ["read_page", "get_page_text", "find", "click", "type", "key", "scroll", "form_input"]) {
  commands[c] = async (args) => (await content(args.tabId, c, args)).result;
}

function summarize(cmd, args, result) {
  const a = { ...args };
  if (typeof a.text === "string") a.text = a.text.length > 40 ? a.text.slice(0, 40) + "…" : a.text;
  let s = JSON.stringify(a);
  if (s === "{}") s = "";
  if (cmd === "screenshot" && result) s += ` → ${result.width}x${result.height}`;
  return s.slice(0, 200);
}

async function handleRequest(sock, msg) {
  const { id, cmd, args = {} } = msg;
  let url = "";
  try {
    const t = await resolveTab(args.tabId).catch(() => null);
    url = t ? t.url : "";
  } catch (e) { /* ignore */ }
  try {
    const fn = commands[cmd];
    if (!fn) throw new Error(`Unknown command: ${cmd}`);
    const result = await fn(args);
    audit({ time: new Date().toISOString(), cmd, url, summary: summarize(cmd, args, result) });
    if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ id, ok: true, result }));
  } catch (e) {
    const error = (e && e.message) || String(e);
    audit({ time: new Date().toISOString(), cmd, url, summary: `ERROR: ${error}`.slice(0, 200) });
    if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ id, ok: false, error }));
  }
}

// ---------------- popup messaging ----------------
browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "status") return Promise.resolve(status());
  if (msg && msg.type === "new-code") {
    const token = newConnectionCode();
    configSource = "generated";
    return browser.storage.local.set({ token }).then(() => ({ token }));
  }
  return undefined;
});

// ---------------- start ----------------
(async () => {
  await loadSettings();
  setBadge();
  connect();
})();
