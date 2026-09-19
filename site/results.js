(function () {
  "use strict";
  const pp = (v) => (v > 0 ? "+" : "") + v.toFixed(1) + " pp";
  const pct = (v) => Math.round(v) + "%";
  const status = document.getElementById("status");

  function tone(p) {
    if (p.evidence !== "strong" && p.evidence !== "moderate") return "neutral";
    return p.direction === "better" ? "pos" : "neg";
  }

  function cell(row, text, cls) {
    const td = document.createElement("td");
    if (cls) td.className = cls;
    td.textContent = text;
    row.appendChild(td);
    return td;
  }

  function render(r) {
    const updated = new Date(r.updated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const check = r.diagnostics.converged ? "sampler converged" : "sampler diagnostics need attention";
    status.textContent = `Updated ${updated}. Based on ${r.sample.ratings} reports over ${r.sample.days} days; ${check}.`;
    document.getElementById("results").hidden = false;

    if (r.predictors.length) {
      Charts.forest(document.getElementById("effects-chart"), r.predictors.map((p) => ({
        label: p.label, detail: p.unit_label, tone: tone(p), ...p.d_happy_pp,
      })), { format: pp, axisLabel: "Change in chance of a Happy report (percentage points)" });
      const body = document.getElementById("effects-table");
      for (const p of r.predictors) {
        const row = document.createElement("tr");
        cell(row, p.label);
        cell(row, p.unit_label);
        cell(row, `${p.odds_ratio.est.toFixed(2)} (${p.odds_ratio.lo.toFixed(2)} to ${p.odds_ratio.hi.toFixed(2)})`, "num");
        cell(row, pp(p.d_happy_pp.est), "num");
        cell(row, pp(p.d_sad_pp.est), "num");
        cell(row, Math.round(p.p_positive * 100) + "%", "num");
        const badge = document.createElement("span");
        badge.className = "badge " + (tone(p) === "neutral" ? "" : p.direction);
        badge.textContent = p.evidence === "confirmatory" ? "judged at 6 and 12 months" : p.evidence;
        cell(row, "").appendChild(badge);
        body.appendChild(row);
      }
    } else {
      document.getElementById("no-effects").hidden = false;
    }

    const levels = (rows, title) => rows.map((t) => ({
      label: title(t.level), tone: "pos",
      est: t.p_happy.est * 100, lo: t.p_happy.lo * 100, hi: t.p_happy.hi * 100,
    }));
    const mean = (rows) => rows.reduce((s, x) => s + x.est, 0) / rows.length;
    const tod = levels(r.time_of_day, (s) => s[0].toUpperCase() + s.slice(1));
    const wd = levels(r.weekday, (s) => s);
    Charts.forest(document.getElementById("tod-chart"), tod, { format: pct, axisLabel: "Chance of a Happy report", zero: mean(tod) });
    Charts.forest(document.getElementById("weekday-chart"), wd, { format: pct, axisLabel: "Chance of a Happy report", zero: mean(wd) });

    const phi = r.dynamics.phi, sigma = r.dynamics.sigma_day;
    document.getElementById("dynamics").textContent =
      `Carry-over of mood from one day to the next (φ) is ${phi.est.toFixed(2)} (95% interval ${phi.lo.toFixed(2)} to ${phi.hi.toFixed(2)}); ` +
      `0 would mean every day starts fresh, 1 that moods linger indefinitely, and a negative value that a good day tends to be followed by a worse one. The day-to-day swing on the logit scale (σ) is ` +
      `${sigma.est.toFixed(2)} (${sigma.lo.toFixed(2)} to ${sigma.hi.toFixed(2)}).`;
  }

  fetch("results.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then(render)
    .catch(() => { status.textContent = "No results have been published yet. The model needs about two weeks of reports first."; });
})();
