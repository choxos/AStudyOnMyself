(function () {
  "use strict";
  const pct = (v) => Math.round(v * 100) + "%";
  const pp = (v) => (v > 0 ? "+" : "") + v.toFixed(1) + " pp";

  const weekly = JSON.parse(document.getElementById("weekly-data").textContent);
  const weeklyEl = document.getElementById("weekly-chart");
  if (weeklyEl) {
    Charts.lines(weeklyEl, {
      x: weekly.x,
      series: [
        { name: "Happy", tone: "pos", values: weekly.happy },
        { name: "Sad", tone: "neg", values: weekly.sad },
      ],
    }, { yMin: 0, yMax: 1, format: pct });
  }

  const tags = JSON.parse(document.getElementById("tags-data").textContent);
  const tagsEl = document.getElementById("tags-chart");
  if (tagsEl && tags.length) {
    Charts.forest(tagsEl, tags.map((t) => ({
      label: "#" + t.tag,
      detail: `${t.n} uses; Happy ${pct(t.p_with)} with, ${pct(t.p_without)} without`,
      est: t.est, lo: t.lo, hi: t.hi,
      tone: t.lo > 0 ? "pos" : t.hi < 0 ? "neg" : "neutral",
    })), { format: pp, axisLabel: "Difference in chance of a Happy report" });
  }
})();
