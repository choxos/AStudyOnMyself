/* Small dependency-free SVG charts: a forest plot and a line chart with bands.
 * Shared by the dashboard and the public results page. Styling lives in CSS
 * classes (pos / neg / neutral), so light and dark mode need no JS. */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";

  function svgEl(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  function niceTicks(min, max, count) {
    const span = max - min || 1;
    const step0 = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || 10 * mag;
    const ticks = [];
    for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(Math.round(t / step) * step);
    return ticks;
  }

  function tooltip(container) {
    let tip = container.querySelector(".tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "tooltip";
      tip.hidden = true;
      container.appendChild(tip);
    }
    return {
      show(lines, x, y) {
        tip.replaceChildren();
        for (const line of lines) {
          const row = document.createElement(line.strong ? "strong" : "div");
          if (line.tone) {
            const key = document.createElement("span");
            key.className = "key " + line.tone;
            row.appendChild(key);
          }
          row.appendChild(document.createTextNode(line.text));
          tip.appendChild(row);
        }
        tip.hidden = false;
        const maxLeft = container.clientWidth - tip.offsetWidth - 4;
        tip.style.left = Math.max(0, Math.min(x + 12, maxLeft)) + "px";
        tip.style.top = Math.max(0, y - tip.offsetHeight - 8) + "px";
      },
      hide() { tip.hidden = true; },
    };
  }

  function whenSized(container, draw) {
    draw();
    let width = container.clientWidth;
    new ResizeObserver(() => {
      if (container.clientWidth !== width) {
        width = container.clientWidth;
        draw();
      }
    }).observe(container);
  }

  /* rows: [{label, detail, est, lo, hi, tone}]; opts: {format, axisLabel, zero} */
  function forest(container, rows, opts) {
    const o = Object.assign({ format: (v) => v.toFixed(1), axisLabel: "", zero: 0 }, opts);
    whenSized(container, function draw() {
      container.querySelectorAll("svg").forEach((s) => s.remove());
      const width = container.clientWidth;
      const rowH = 42, top = 8, axisH = 40, padX = 8;
      const height = top + rows.length * rowH + axisH;
      const lo = Math.min(o.zero, ...rows.map((r) => r.lo));
      const hi = Math.max(o.zero, ...rows.map((r) => r.hi));
      const pad = (hi - lo) * 0.05 || 1;
      const ticks = niceTicks(lo - pad, hi + pad, width < 480 ? 4 : 7);
      const dMin = Math.min(ticks[0], lo - pad), dMax = Math.max(ticks[ticks.length - 1], hi + pad);
      const x = (v) => padX + ((v - dMin) / (dMax - dMin)) * (width - 2 * padX);
      const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, height, role: "group", "aria-label": o.axisLabel });
      const plotBottom = top + rows.length * rowH;
      for (const t of ticks) {
        svgEl("line", { class: "grid-line", x1: x(t), x2: x(t), y1: top, y2: plotBottom }, svg);
        svgEl("text", { x: x(t), y: plotBottom + 16, "text-anchor": "middle", class: "axis-label" }, svg).textContent = o.format(t);
      }
      svgEl("line", { class: "zero-line", x1: x(o.zero), x2: x(o.zero), y1: top, y2: plotBottom }, svg);
      svgEl("text", { x: width / 2, y: plotBottom + 34, "text-anchor": "middle", class: "axis-label" }, svg).textContent = o.axisLabel;
      const tip = tooltip(container);
      rows.forEach((r, i) => {
        const y0 = top + i * rowH;
        const g = svgEl("g", { class: "row", tabindex: 0, role: "img" }, svg);
        svgEl("rect", { class: "row-hit", x: 0, y: y0, width, height: rowH, rx: 6 }, g);
        svgEl("text", { x: padX, y: y0 + 14 }, g).textContent = r.label;
        const yMark = y0 + 29;
        svgEl("line", { class: "interval " + r.tone, x1: x(r.lo), x2: x(r.hi), y1: yMark, y2: yMark }, g);
        svgEl("circle", { class: "dot " + r.tone, cx: x(r.est), cy: yMark, r: 4.5 }, g);
        const lines = [
          { text: `${o.format(r.est)} (95% interval ${o.format(r.lo)} to ${o.format(r.hi)})`, strong: true },
          { text: r.label },
        ];
        if (r.detail) lines.push({ text: r.detail });
        g.setAttribute("aria-label", `${r.label}: ${lines[0].text}`);
        const show = () => tip.show(lines, x(r.est), yMark);
        g.addEventListener("pointerenter", show);
        g.addEventListener("focus", show);
        g.addEventListener("pointerleave", tip.hide);
        g.addEventListener("blur", tip.hide);
      });
      container.insertBefore(svg, container.firstChild);
    });
  }

  /* data: {x: [labels], series: [{name, tone, values, lo, hi}]}; opts: {yMin, yMax, format, height} */
  function lines(container, data, opts) {
    const o = Object.assign({ yMin: 0, yMax: 1, format: (v) => v.toFixed(2), height: 220 }, opts);
    const n = data.x.length;
    whenSized(container, function draw() {
      container.querySelectorAll("svg, .legend").forEach((s) => s.remove());
      if (data.series.length > 1) {
        const legend = document.createElement("div");
        legend.className = "legend";
        for (const s of data.series) {
          const item = document.createElement("span");
          const key = document.createElement("span");
          key.className = "key " + s.tone;
          item.append(key, document.createTextNode(s.name));
          legend.appendChild(item);
        }
        container.insertBefore(legend, container.firstChild);
      }
      const width = container.clientWidth;
      const left = 40, right = 8, top = 8, bottom = 24, h = o.height;
      const x = (i) => left + (n <= 1 ? 0 : (i / (n - 1)) * (width - left - right));
      const y = (v) => top + (1 - (v - o.yMin) / (o.yMax - o.yMin)) * (h - top - bottom);
      const svg = svgEl("svg", { viewBox: `0 0 ${width} ${h}`, height: h, tabindex: 0, role: "img" });
      for (const t of niceTicks(o.yMin, o.yMax, 4)) {
        svgEl("line", { class: "grid-line", x1: left, x2: width - right, y1: y(t), y2: y(t) }, svg);
        svgEl("text", { x: left - 6, y: y(t) + 4, "text-anchor": "end", class: "axis-label" }, svg).textContent = o.format(t);
      }
      const xTicks = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0];
      for (const i of xTicks) {
        const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
        svgEl("text", { x: x(i), y: h - 6, "text-anchor": anchor, class: "axis-label" }, svg).textContent = data.x[i];
      }
      for (const s of data.series) {
        if (s.lo && s.hi) {
          let upper = "", lower = "";
          s.lo.forEach((v, i) => {
            if (v == null || s.hi[i] == null) return;
            upper += (upper ? "L" : "M") + x(i) + "," + y(s.hi[i]);
            lower = "L" + x(i) + "," + y(v) + lower;
          });
          if (upper) svgEl("path", { class: "band " + s.tone, d: upper + lower + "Z" }, svg);
        }
        let d = "", pen = false;
        s.values.forEach((v, i) => {
          if (v == null) { pen = false; return; }
          d += (pen ? "L" : "M") + x(i) + "," + y(v);
          pen = true;
        });
        svgEl("path", { class: "line " + s.tone, d }, svg);
        // A value with no neighbor on either side has no line segment; mark it.
        s.values.forEach((v, i) => {
          if (v != null && s.values[i - 1] == null && s.values[i + 1] == null) {
            svgEl("circle", { class: "dot " + s.tone, cx: x(i), cy: y(v), r: 4 }, svg);
          }
        });
      }
      const cross = svgEl("line", { class: "crosshair", y1: top, y2: h - bottom, visibility: "hidden" }, svg);
      const tip = tooltip(container);
      let current = n - 1;
      const showAt = (i) => {
        current = Math.max(0, Math.min(n - 1, i));
        cross.setAttribute("x1", x(current));
        cross.setAttribute("x2", x(current));
        cross.setAttribute("visibility", "visible");
        const rows = [{ text: data.x[current], strong: true }];
        for (const s of data.series) {
          const v = s.values[current];
          rows.push({ tone: s.tone, text: `${s.name}: ${v == null ? "no data" : o.format(v)}` });
        }
        tip.show(rows, x(current), top + 20);
      };
      svg.addEventListener("pointermove", (e) => {
        const box = svg.getBoundingClientRect();
        const px = ((e.clientX - box.left) / box.width) * width;
        showAt(Math.round(((px - left) / (width - left - right)) * (n - 1)));
      });
      svg.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") showAt(current - 1);
        if (e.key === "ArrowRight") showAt(current + 1);
      });
      svg.addEventListener("focus", () => showAt(current));
      const hide = () => { tip.hide(); cross.setAttribute("visibility", "hidden"); };
      svg.addEventListener("pointerleave", hide);
      svg.addEventListener("blur", hide);
      const legend = container.querySelector(".legend");
      container.insertBefore(svg, legend ? legend.nextSibling : container.firstChild);
    });
  }

  window.Charts = { forest, lines };
})();
