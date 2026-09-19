(function () {
  "use strict";
  const pp = (v) => (v > 0 ? "+" : "") + v.toFixed(1) + " pp";
  const pct = (v) => Math.round(v) + "%";
  const data = JSON.parse(document.getElementById("chart-data").textContent);

  if (data) {
    const mount = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
    mount("effects-chart", (el) => Charts.forest(el, data.effects, {
      format: pp, axisLabel: "Change in chance of a Happy report (percentage points)",
    }));
    const levels = (rows) => rows.reduce((s, r) => s + r.est, 0) / rows.length;
    mount("tod-chart", (el) => Charts.forest(el, data.time_of_day, {
      format: pct, axisLabel: "Chance of a Happy report", zero: levels(data.time_of_day),
    }));
    mount("weekday-chart", (el) => Charts.forest(el, data.weekday, {
      format: pct, axisLabel: "Chance of a Happy report", zero: levels(data.weekday),
    }));
    if (data.daily) {
      mount("daily-chart", (el) => Charts.lines(el, {
        x: data.daily.dates,
        series: [{ name: "Chance of Happy", tone: "pos", values: data.daily.mean, lo: data.daily.lo, hi: data.daily.hi }],
      }, { yMin: 0, yMax: 1, format: (v) => Math.round(v * 100) + "%" }));
    }
  }

  // While a refit runs, poll until a newer run has finished, then reload.
  const status = document.getElementById("run-status");
  const startId = Number(status.dataset.runId);
  if (status.dataset.runStatus === "running" || "waiting" in status.dataset) {
    const started = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - started > 15 * 60 * 1000) return clearInterval(timer);
      const r = await fetch(status.dataset.url || "/analysis/status/", { credentials: "same-origin" }).catch(() => null);
      if (!r || !r.ok) return;
      const run = await r.json();
      const finished = run.status && run.status !== "running";
      if (finished && (run.id > startId || status.dataset.runStatus === "running")) {
        clearInterval(timer);
        location.replace(location.pathname);
      }
    }, 4000);
  }
})();
