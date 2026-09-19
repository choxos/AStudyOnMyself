/* Turns reminder notifications on or off for this device. The browser asks for
 * permission only after a tap, and on an iPhone only in the Home Screen app. */
(function () {
  "use strict";
  const box = document.getElementById("push");
  if (!box) return;
  const status = box.querySelector(".status-line");
  const csrf = document.querySelector('meta[name="csrf-token"]').content;
  const say = (text) => { status.textContent = text; };

  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    say("This browser cannot receive reminders here. On an iPhone, add the app to the Home Screen, open it from there (iOS 16.4 or later) and come back to this page.");
    box.querySelectorAll("[data-push]").forEach((b) => { b.disabled = true; });
    return;
  }

  const post = (url, body) => fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrf },
    body: JSON.stringify(body || {}),
  });

  function keyBytes(base64url) {
    const text = atob(base64url.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(text, (c) => c.charCodeAt(0));
  }

  async function registration() {
    await navigator.serviceWorker.register("/sw.js");
    return navigator.serviceWorker.ready;
  }

  async function turnOn() {
    if ((await Notification.requestPermission()) !== "granted") {
      say("Notifications are blocked for this app. Allow them in the phone's settings, then try again.");
      return;
    }
    const reg = await registration();
    const { key } = await (await fetch("/push/key/", { credentials: "same-origin" })).json();
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    const res = await post("/push/subscribe/", sub.toJSON());
    say(res.ok ? "Reminders are on for this device." : "The server did not accept this device. Try again.");
  }

  async function turnOff() {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await post("/push/unsubscribe/", { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
    say("Reminders are off for this device.");
  }

  async function test() {
    const res = await post("/push/test/");
    const { statuses } = res.ok ? await res.json() : { statuses: [] };
    const delivered = statuses.filter((s) => s >= 200 && s < 300).length;
    say(statuses.length ? `Sent to ${delivered} of ${statuses.length} device(s).` : "No device has reminders on yet.");
  }

  const actions = { on: turnOn, off: turnOff, test };
  box.addEventListener("click", (event) => {
    const button = event.target.closest("[data-push]");
    if (!button) return;
    button.disabled = true;
    actions[button.dataset.push]().catch(() => say("That did not work. Check the connection and try again."))
      .finally(() => { button.disabled = false; });
  });
})();
