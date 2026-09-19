/* One-tap mood reports with an offline queue.
 * Every report is stored on the device first (with its own timestamp and a
 * client_id) and then sent. If the server is asleep or unreachable it stays
 * queued and is sent later; the client_id keeps retries from duplicating it. */
(function () {
  "use strict";
  const KEY = "asom-queue";
  const widget = document.querySelector("[data-rate]");
  let csrfToken = document.querySelector('meta[name="csrf-token"]').content;
  let memory = [];

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return memory; }
  }
  function store(queue) {
    try { localStorage.setItem(KEY, JSON.stringify(queue)); } catch (e) { memory = queue; }
  }
  function drop(id) { store(load().filter((q) => q.client_id !== id)); }
  function say(text) { if (widget) widget.querySelector("[data-status]").textContent = text; }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function post(item) {
    return fetch("/api/ratings/", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken },
      body: JSON.stringify(item),
    });
  }

  async function freshToken() {
    const r = await fetch("/csrf/", { credentials: "same-origin" });
    // Signed out: /csrf/ redirects to the login page, which is not JSON.
    if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) throw new Error("signed out");
    csrfToken = (await r.json()).token;
  }

  // The safety notice follows the server's answer (protocol Section 2.11). Only the
  // answer to the most recent request may change it, so a slow answer to an older
  // request can never undo a newer one.
  let latest = 0;
  function safety(body, request) {
    const notice = document.querySelector("[data-safety]");
    if (request === latest && notice && body && typeof body.safety === "boolean") notice.hidden = !body.safety;
  }
  async function checkSafety() {
    const request = ++latest;
    try {
      const r = await fetch("/api/safety/", { credentials: "same-origin" });
      if ((r.headers.get("content-type") || "").includes("json")) safety(await r.json(), request);
    } catch (e) { /* offline: checked again next time */ }
  }

  async function saved(response, request) {
    if (!response.ok) return false;
    const body = await response.json().catch(() => null);
    safety(body, request);
    return Boolean(body && body.id);
  }

  let busy = false;
  async function flush() {
    if (busy) return;
    busy = true;
    let signedOut = false, rejected = 0, sent = 0;
    try {
      for (const item of load()) {
        let r, request = ++latest;
        try { r = await post(item); } catch (e) { break; } // offline: keep everything
        if (r.status === 403) {
          try { await freshToken(); request = ++latest; r = await post(item); } catch (e) { signedOut = true; break; }
        }
        if (await saved(r, request)) { drop(item.client_id); sent += 1; }
        else if (r.status === 400) { rejected += 1; drop(item.client_id); }
        else { signedOut = r.status === 401 || r.status === 403; break; }
      }
    } finally {
      busy = false;
    }
    const left = load().length;
    if (signedOut) say(`${left} report(s) kept on this device. Sign in to send them.`);
    else if (left) say(`Kept on this device (${left} waiting). They will be sent when the server is reachable.`);
    else if (rejected) say(`${rejected} report(s) were too old or invalid and were discarded.`);
    else if (sent) say(`Sent ${sent} report(s) saved on this device.`);
    return left;
  }

  function record(mood) {
    const note = widget.querySelector("#rate-note");
    const tags = [...widget.querySelectorAll('[data-tag][aria-pressed="true"]')].map((b) => b.dataset.tag);
    const queue = load();
    queue.push({
      client_id: uuid(),
      rating: mood,
      recorded_at: new Date().toISOString(),
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      note: note ? note.value.trim() : "",
      tags,
      source: "web",
    });
    store(queue);
    say("Saving…");
    flush().then((left) => {
      if (left) return;
      say("Saved. Thank you.");
      if (note) note.value = "";
      widget.querySelectorAll("[data-tag]").forEach((b) => b.setAttribute("aria-pressed", "false"));
      if ("reload" in widget.dataset) setTimeout(() => location.reload(), 700);
    });
  }

  if (widget) {
    widget.querySelectorAll("[data-mood]").forEach((button) => {
      button.addEventListener("click", () => record(Number(button.dataset.mood)));
    });
    widget.querySelectorAll("[data-tag]").forEach((button) => {
      button.addEventListener("click", () => {
        button.setAttribute("aria-pressed", button.getAttribute("aria-pressed") === "true" ? "false" : "true");
      });
    });
  }
  window.addEventListener("online", () => flush().then(checkSafety));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) flush().then(checkSafety); });
  setInterval(flush, 60000);
  if (load().length) flush();
})();
