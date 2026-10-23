/* Claude Firefox Bridge: content script, injected on demand. */
(() => {
  "use strict";
  if (window.__claudeBridgeLoaded) return;
  window.__claudeBridgeLoaded = true;

  // Refs live only inside this content script. Nothing is written to the page's DOM, so a page can neither see
  // which elements Claude picked nor plant an element that answers to a ref.
  const refs = new Map(); // "r12" -> Element
  const refOf = new WeakMap(); // Element -> "r12"
  let refCounter = 0;

  // ---------------- element helpers ----------------
  function refFor(el) {
    let r = refOf.get(el);
    if (r && refs.get(r) === el) return r;
    r = `r${++refCounter}`;
    refOf.set(el, r);
    refs.set(r, el);
    return r;
  }

  function byRef(ref) {
    const key = String(ref).replace(/^\[|\]$/g, "");
    const el = refs.get(key);
    if (!el) throw new Error(`Unknown ref "${ref}". Call read_page or find again.`);
    if (!el.isConnected) throw new Error(`The element for ref "${ref}" is no longer on the page. Call read_page or find again.`);
    return el;
  }

  // Every element, including those inside open shadow roots.
  function* allElements(root) {
    for (const el of root.querySelectorAll("*")) {
      yield el;
      if (el.shadowRoot) yield* allElements(el.shadowRoot);
    }
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return false;
    if (parseFloat(cs.opacity) === 0) return false;
    return true;
  }

  const INTERACTIVE_SEL = [
    "a[href]", "a", "button", "input:not([type=hidden])", "select", "textarea", "summary",
    "[role=button]", "[role=link]", "[role=tab]", "[role=menuitem]", "[role=checkbox]",
    "[role=radio]", "[role=switch]", "[role=option]", "[role=combobox]", "[role=textbox]", "[role=searchbox]",
    "[contenteditable]:not([contenteditable=false])", "[onclick]",
  ].join(",");

  const isInteractive = (el) => el.matches(INTERACTIVE_SEL);

  function roleOf(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.split(/\s+/)[0];
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case "a": return el.hasAttribute("href") ? "link" : "a";
      case "button": return "button";
      case "select": return "combobox";
      case "textarea": return "textbox";
      case "img": return "img";
      case "summary": return "button";
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return `heading${tag[1]}`;
      case "input": {
        const t = (el.type || "text").toLowerCase();
        if (["button", "submit", "reset", "image"].includes(t)) return "button";
        if (t === "checkbox") return "checkbox";
        if (t === "radio") return "radio";
        if (t === "search") return "searchbox";
        if (t === "range") return "slider";
        return `textbox[${t}]`;
      }
      default:
        if (el.isContentEditable) return "textbox[editable]";
        return tag;
    }
  }

  const clean = (s, n = 80) => {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  };

  function nameOf(el) {
    let n = el.getAttribute("aria-label");
    if (!n) {
      const lb = el.getAttribute("aria-labelledby");
      if (lb) n = lb.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
    }
    if (!n && !["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) n = el.innerText;
    if (!n && el.tagName === "INPUT" && ["button", "submit", "reset"].includes(el.type)) n = el.value;
    if (!n && el.labels && el.labels.length) n = el.labels[0].innerText;
    if (!n) n = el.getAttribute("placeholder");
    if (!n) n = el.getAttribute("title");
    if (!n) n = el.getAttribute("alt");
    return clean(n);
  }

  function valueOf(el) {
    if (el.tagName === "INPUT") {
      const t = (el.type || "").toLowerCase();
      if (t === "checkbox" || t === "radio") return el.checked ? "checked" : "unchecked";
      if (t === "password") return el.value ? "••••" : "";
      if (["button", "submit", "reset"].includes(t)) return "";
      return clean(el.value, 60);
    }
    if (el.tagName === "TEXTAREA") return clean(el.value, 60);
    if (el.tagName === "SELECT") return clean(el.selectedOptions[0]?.text || el.value, 60);
    const checked = el.getAttribute("aria-checked") || el.getAttribute("aria-selected");
    return checked ? `${el.hasAttribute("aria-checked") ? "checked" : "selected"}=${checked}` : "";
  }

  function center(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }

  function line(el, depth) {
    const { x, y } = center(el);
    const v = valueOf(el);
    return `${"  ".repeat(depth)}[${refFor(el)}] ${roleOf(el)} "${nameOf(el)}"${v ? ` (${v})` : ""} @${x},${y}`;
  }

  function hasOwnText(el) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    return false;
  }

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "SVG", "PATH"]);

  function childrenOf(el) {
    const kids = [...el.children];
    if (el.shadowRoot) kids.push(...el.shadowRoot.children);
    return kids;
  }

  // ---------------- commands ----------------
  function read_page({ filter = "interactive" }) {
    const MAX = 1500;
    const out = [];
    let truncated = false;
    const walk = (el, depth) => {
      if (out.length >= MAX) { truncated = true; return; }
      if (SKIP_TAGS.has(el.tagName.toUpperCase())) return;
      let cs;
      try { cs = getComputedStyle(el); } catch (e) { return; }
      if (cs.display === "none") return; // whole subtree hidden
      let include = false;
      if (isVisible(el)) {
        if (filter === "all") include = isInteractive(el) || hasOwnText(el) || /^(IMG|H[1-6]|VIDEO|IFRAME)$/.test(el.tagName);
        else include = isInteractive(el);
      }
      if (include) out.push(line(el, depth));
      // Don't descend into interactive leaves in "interactive" mode except containers like contenteditable/role=tab lists
      for (const c of childrenOf(el)) walk(c, include ? depth + 1 : depth);
    };
    if (document.body) walk(document.body, 0);
    const header = `${document.title} | ${location.href} | viewport ${innerWidth}x${innerHeight} scrollY ${Math.round(scrollY)}`;
    return [header, ...out, ...(truncated ? [`… truncated at ${MAX} lines`] : [])].join("\n");
  }

  function get_page_text({ max_chars = 20000 }) {
    const t = (document.body?.innerText || "").replace(/[ \t\f\v ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
    return t.length > max_chars ? t.slice(0, max_chars) + `\n… [truncated, ${t.length} chars total]` : t;
  }

  function find({ query }) {
    const q = String(query || "").toLowerCase().trim();
    if (!q) throw new Error("Empty query.");
    const hits = [];
    const attrs = ["aria-label", "placeholder", "title", "alt", "name", "value"];
    for (const el of allElements(document.body)) {
      if (SKIP_TAGS.has(el.tagName.toUpperCase())) continue;
      if (!isVisible(el)) continue;
      let matched = attrs.some((a) => (el.getAttribute(a) || "").toLowerCase().includes(q));
      if (!matched) {
        const txt = (el.innerText || "").toLowerCase();
        if (txt.includes(q)) {
          // keep the deepest match unless the element is interactive
          const childHas = [...el.children].some((c) => (c.innerText || "").toLowerCase().includes(q));
          matched = isInteractive(el) || !childHas;
        }
      }
      if (matched) hits.push(el);
    }
    hits.sort((a, b) => isInteractive(b) - isInteractive(a));
    const lines = hits.slice(0, 50).map((el) => line(el, 0));
    if (!lines.length) return `No visible elements match "${query}".`;
    return lines.join("\n") + (hits.length > 50 ? `\n… ${hits.length - 50} more` : "");
  }

  function mouse(el, type, x, y, button, extra = {}) {
    const isPointer = type.startsWith("pointer");
    const Ctor = isPointer && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
    const buttons = /down/.test(type) ? (button === 2 ? 2 : 1) : 0;
    const ev = new Ctor(type, {
      bubbles: !/enter|leave/.test(type), cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x + screenX, screenY: y + screenY,
      button, buttons, detail: extra.detail ?? 1,
      ...(isPointer ? { pointerId: 1, pointerType: "mouse", isPrimary: true } : {}),
    });
    return el.dispatchEvent(ev);
  }

  function resolveTarget({ ref, x, y }) {
    if (ref != null) {
      const el = byRef(ref);
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const c = center(el);
      // If something overlays the element, still target the element itself.
      return { el, x: c.x, y: c.y };
    }
    if (x == null || y == null) throw new Error("click needs a ref or x,y.");
    const el = document.elementFromPoint(x, y);
    if (!el) throw new Error(`Nothing at ${x},${y} (outside viewport?).`);
    return { el, x, y };
  }

  function click(args) {
    const { el, x, y } = resolveTarget(args);
    const button = args.button === "right" ? 2 : 0;
    const one = (detail) => {
      mouse(el, "pointerover", x, y, button); mouse(el, "pointerenter", x, y, button);
      mouse(el, "mouseover", x, y, button);
      mouse(el, "pointerdown", x, y, button, { detail });
      const downOk = mouse(el, "mousedown", x, y, button, { detail });
      if (downOk && typeof el.focus === "function") {
        const f = el.closest("a,button,input,select,textarea,[tabindex],[contenteditable]") || el;
        try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      }
      mouse(el, "pointerup", x, y, button, { detail });
      mouse(el, "mouseup", x, y, button, { detail });
      if (button === 2) { mouse(el, "contextmenu", x, y, 2); return; }
      let handled = false;
      const onClick = () => { handled = true; };
      el.addEventListener("click", onClick, { once: true });
      mouse(el, "click", x, y, 0, { detail });
      el.removeEventListener("click", onClick);
      if (!handled && typeof el.click === "function") el.click();
    };
    one(1);
    if (args.double && button === 0) { one(2); mouse(el, "dblclick", x, y, 0, { detail: 2 }); }
    return `clicked ${roleOf(el)} "${nameOf(el)}" at ${x},${y}${args.double ? " (double)" : ""}${button === 2 ? " (right)" : ""}`;
  }

  // Fields Claude must never type into: passwords, payment details and one-time codes. Detected from the field's
  // type, autocomplete, masking, and its name, id, label, placeholder and ARIA text. Best effort: a page can still
  // disguise a field, so the skill also tells Claude to leave these to the user.
  const SENSITIVE_HINT = new RegExp([
    "\\bpass(word|wd|code|phrase)?\\b", "\\bpin\\b", "\\bcard ?(number|no|num)\\b", "\\bcc ?(number|num|csc|cvc|cvv|exp)",
    "\\bcvv2?\\b", "\\bcvc\\b", "\\bcsc\\b", "security ?code", "\\bexp(iry|iration)?( date| month| year)?\\b",
    "\\botp\\b", "one ?time ?(code|pass)", "verification ?code", "auth(entication)? ?code", "\\b2fa\\b", "\\bmfa\\b",
    "\\bssn\\b", "social security", "\\biban\\b", "routing ?number", "account ?number",
  ].join("|"), "i");

  function hintText(el) {
    const parts = ["name", "id", "autocomplete", "aria-label", "placeholder", "title"].map((a) => el.getAttribute(a) || "");
    try { if (el.labels) for (const l of el.labels) parts.push(l.textContent || ""); } catch (e) { /* not labelable */ }
    const lb = el.getAttribute("aria-labelledby");
    if (lb) for (const id of lb.split(/\s+/)) parts.push((el.getRootNode().getElementById?.(id) || document.getElementById(id))?.textContent || "");
    // "cardNumber", "card_number" and "card-number" all become "card number"
    return parts.join(" ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.[\]]+/g, " ").slice(0, 2000);
  }

  function isSensitive(el) {
    if (!el || !el.getAttribute) return false;
    const type = (el.getAttribute("type") || "").toLowerCase();
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (el.tagName === "INPUT" && type === "password") return true;
    if (/\bcc-|one-time-code|current-password|new-password/.test(ac)) return true;
    try {
      const masking = getComputedStyle(el).getPropertyValue("-webkit-text-security");
      if (masking && masking !== "none") return true; // a text field drawn as dots, like a password
    } catch (e) { /* ignore */ }
    const editable = el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable ||
      (el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "reset", "file", "image", "range", "color", "hidden"].includes(type));
    return editable && SENSITIVE_HINT.test(hintText(el));
  }

  function deepActive() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }

  const nativeSetter = (el) =>
    Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value").set;

  function keyInit(ch) {
    let code = "";
    if (/^[a-z]$/i.test(ch)) code = `Key${ch.toUpperCase()}`;
    else if (/^[0-9]$/.test(ch)) code = `Digit${ch}`;
    else if (ch === " ") code = "Space";
    return { key: ch, code, bubbles: true, cancelable: true, composed: true };
  }

  function insertIntoField(el, str) {
    const set = nativeSetter(el);
    let start = null, end = null;
    try { start = el.selectionStart; end = el.selectionEnd; } catch (e) { /* type without selection API */ }
    let v = el.value;
    if (start != null && end != null) v = v.slice(0, start) + str + v.slice(end);
    else v += str;
    set.call(el, v);
    if (start != null) { try { el.setSelectionRange(start + str.length, start + str.length); } catch (e) { /* ignore */ } }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: str }));
  }

  function type({ text, ref }) {
    let el = ref != null ? byRef(ref) : deepActive();
    if (ref != null) { el.scrollIntoView({ block: "center", behavior: "instant" }); el.focus(); }
    if (isSensitive(el)) throw new Error("Typing into password/payment fields is disabled.");
    const isField = el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "reset", "file", "image"].includes(el.type)));
    const editable = el && el.isContentEditable;
    if (!isField && !editable) throw new Error(`Focused element is not editable (${el ? roleOf(el) : "none"}). Click a field first or pass a ref.`);
    for (const ch of String(text)) {
      const init = ch === "\n" ? { key: "Enter", code: "Enter", bubbles: true, cancelable: true, composed: true } : keyInit(ch);
      const ok = el.dispatchEvent(new KeyboardEvent("keydown", init));
      if (ok) el.dispatchEvent(new KeyboardEvent("keypress", init));
      if (ok) {
        if (isField) {
          if (ch === "\n" && el.tagName !== "TEXTAREA") { /* newline in single-line input: ignore */ }
          else insertIntoField(el, ch);
        } else {
          document.execCommand("insertText", false, ch);
        }
      }
      el.dispatchEvent(new KeyboardEvent("keyup", init));
    }
    if (isField) el.dispatchEvent(new Event("change", { bubbles: true }));
    return `typed ${String(text).length} chars into ${roleOf(el)} "${nameOf(el)}"`;
  }

  const KEY_ALIASES = {
    enter: "Enter", return: "Enter", tab: "Tab", escape: "Escape", esc: "Escape", backspace: "Backspace",
    delete: "Delete", del: "Delete", space: " ", arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft",
    arrowright: "ArrowRight", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
    home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown",
  };

  function focusables() {
    return [...document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,[tabindex],[contenteditable]:not([contenteditable=false]),summary")]
      .filter((e) => !e.disabled && e.tabIndex >= 0 && isVisible(e));
  }

  function pressOne(combo) {
    const parts = combo.split("+").filter(Boolean);
    let keyName = parts.pop() || "";
    const mods = parts.map((p) => p.toLowerCase());
    const ctrlKey = mods.includes("ctrl") || mods.includes("control");
    const shiftKey = mods.includes("shift");
    const altKey = mods.includes("alt");
    const metaKey = mods.includes("meta") || mods.includes("cmd") || mods.includes("win");
    const key = KEY_ALIASES[keyName.toLowerCase()] || (keyName.length === 1 ? keyName : keyName[0].toUpperCase() + keyName.slice(1));
    const el = deepActive() || document.body;
    if (isSensitive(el) && key.length === 1 && !ctrlKey && !metaKey && !altKey) throw new Error("Typing into password/payment fields is disabled.");
    const code = key === " " ? "Space" : key.length === 1 ? (/[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : /[0-9]/.test(key) ? `Digit${key}` : "") : key;
    const init = { key, code, ctrlKey, shiftKey, altKey, metaKey, bubbles: true, cancelable: true, composed: true };
    if (key === "Enter") Object.assign(init, { keyCode: 13, which: 13 });
    const ok = el.dispatchEvent(new KeyboardEvent("keydown", init));
    const printable = key.length === 1 || key === "Enter";
    let pressOk = ok;
    if (ok && printable && !ctrlKey && !metaKey) pressOk = el.dispatchEvent(new KeyboardEvent("keypress", init));

    const isField = el.tagName === "INPUT" || el.tagName === "TEXTAREA";
    if (ok && pressOk) {
      if (key === "Enter") {
        if (el.tagName === "TEXTAREA") insertIntoField(el, "\n");
        else if (el.tagName === "INPUT" && el.form) {
          if (typeof el.form.requestSubmit === "function") el.form.requestSubmit(); else el.form.submit();
        } else if (el.matches && el.matches("a[href],button,[role=button],[role=link],summary")) el.click();
      } else if (key === "Tab") {
        const list = focusables();
        const i = list.indexOf(el);
        const next = list[(i + (shiftKey ? -1 : 1) + list.length) % list.length];
        if (next) next.focus();
      } else if (key.toLowerCase() === "a" && (ctrlKey || metaKey)) {
        if (isField && typeof el.select === "function") el.select();
        else if (el.isContentEditable) document.execCommand("selectAll");
        else getSelection().selectAllChildren(document.body);
      } else if (key === "Backspace" && isField) {
        const set = nativeSetter(el);
        let s = null, e2 = null;
        try { s = el.selectionStart; e2 = el.selectionEnd; } catch (x) { /* ignore */ }
        if (s != null) {
          const from = s === e2 ? Math.max(0, s - 1) : s;
          set.call(el, el.value.slice(0, from) + el.value.slice(e2));
          el.setSelectionRange(from, from);
        } else set.call(el, el.value.slice(0, -1));
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
      } else if (key === "Backspace" && el.isContentEditable) {
        document.execCommand("delete");
      } else if (key.length === 1 && !ctrlKey && !metaKey && !altKey && isField) {
        insertIntoField(el, key);
      } else if (!isField && !el.isContentEditable) {
        const scrolls = { PageDown: innerHeight * 0.9, PageUp: -innerHeight * 0.9, " ": shiftKey ? -innerHeight * 0.9 : innerHeight * 0.9, ArrowDown: 40, ArrowUp: -40 };
        if (key === "Home") scrollTo({ top: 0, behavior: "instant" });
        else if (key === "End") scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
        else if (scrolls[key] && el === document.body) scrollBy({ top: scrolls[key], behavior: "instant" });
      }
    }
    el.dispatchEvent(new KeyboardEvent("keyup", init));
    return combo;
  }

  function key({ keys }) {
    const list = String(keys).trim().split(/\s+/).filter(Boolean);
    if (!list.length) throw new Error("No keys given.");
    const done = list.map(pressOne);
    const a = deepActive();
    return `pressed ${done.join(" ")}; focus now ${a ? `${roleOf(a)} "${nameOf(a)}"` : "none"}`;
  }

  function scrollableAncestor(el) {
    for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const canY = /(auto|scroll|overlay)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight;
      const canX = /(auto|scroll|overlay)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth;
      if (canY || canX) return e;
    }
    return null;
  }

  function scroll({ direction, amount = 3, x, y }) {
    const px = Number(amount) * 100;
    const dx = direction === "left" ? -px : direction === "right" ? px : 0;
    const dy = direction === "up" ? -px : direction === "down" ? px : 0;
    let target = null;
    if (x != null && y != null) {
      const el = document.elementFromPoint(x, y);
      target = el && scrollableAncestor(el);
    }
    if (target) {
      target.scrollBy({ left: dx, top: dy, behavior: "instant" });
      return `scrolled element ${roleOf(target)} by ${dx},${dy}; now at ${Math.round(target.scrollLeft)},${Math.round(target.scrollTop)}`;
    }
    window.scrollBy({ left: dx, top: dy, behavior: "instant" });
    return `scrolled window by ${dx},${dy}; now scrollY ${Math.round(scrollY)} of ${document.documentElement.scrollHeight - innerHeight}`;
  }

  function form_input({ ref, value }) {
    const el = byRef(ref);
    if (isSensitive(el)) throw new Error("Typing into password/payment fields is disabled.");
    if (el.tagName === "SELECT") {
      const v = String(value);
      const opt = [...el.options].find((o) => o.value === v) || [...el.options].find((o) => o.text.trim().toLowerCase() === v.toLowerCase());
      if (!opt) throw new Error(`No option "${v}". Options: ${[...el.options].map((o) => o.text.trim() || o.value).slice(0, 30).join(" | ")}`);
      el.value = opt.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return `selected "${opt.text.trim()}"`;
    }
    const isCheck = el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio");
    const isAriaCheck = /^(checkbox|radio|switch)$/.test(el.getAttribute("role") || "");
    if (isCheck || isAriaCheck) {
      const want = !(value === false || value === 0 || /^(false|0|off|no|unchecked)$/i.test(String(value)));
      const cur = isCheck ? el.checked : el.getAttribute("aria-checked") === "true";
      if (cur !== want) el.click(); // click toggles state and fires input/change natively
      if (isCheck && el.checked !== want) {
        el.checked = want;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return `${roleOf(el)} now ${isCheck ? (el.checked ? "checked" : "unchecked") : el.getAttribute("aria-checked")}`;
    }
    throw new Error(`form_input supports select, checkbox and radio; got ${roleOf(el)}. Use type for text fields.`);
  }

  const handlers = {
    viewport: () => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }),
    read_page, get_page_text, find, click, type, key, scroll, form_input,
  };

  browser.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.__claude) return undefined;
    try {
      const fn = Object.hasOwn(handlers, msg.cmd) ? handlers[msg.cmd] : null;
      if (!fn) throw new Error(`Unknown page command ${msg.cmd}`);
      return Promise.resolve({ ok: true, result: fn(msg.args || {}) });
    } catch (e) {
      return Promise.resolve({ ok: false, error: (e && e.message) || String(e) });
    }
  });
})();
