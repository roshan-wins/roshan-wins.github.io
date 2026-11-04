/* Two-degree-of-freedom bicycle model of the Volvo S90, linear vs Fiala axle tyres.
   Parameters and equations follow the SD2225 Group 7 report (m = 1995 kg,
   Iz = 3090 kg m², L = 2.941 m, CG at 43.45 % of L from the front axle, steering
   ratio 16.3, mu = 0.85). Integrated with RK4 at 5 ms whenever a control changes. */
(function () {
  var root = document.querySelector("[data-sim]");
  if (!root) return;

  var P = { m: 1995, J: 3090, L: 2.941, lam: 0.4345, is: 16.3, g: 9.81 };
  var f = P.lam * P.L, b = P.L - f;
  var NS = "http://www.w3.org/2000/svg";

  function fiala(a, C, Fz, mu) {
    var ac = Math.atan(3 * mu * Fz / C);
    var s = a < 0 ? -1 : 1;
    if (Math.abs(a) <= ac) {
      var t = Math.abs(Math.tan(a));
      return s * (C * t - C * C / (3 * mu * Fz) * t * t + C * C * C / (27 * mu * mu * Fz * Fz) * t * t * t);
    }
    return s * mu * Fz;
  }

  function steer(t, o) {
    var A = o.amp * Math.PI / 180, t0 = 0.5;
    if (o.man === "step") {
      if (t < t0) return 0;
      var u = Math.min((t - t0) / 0.25, 1);
      return A * (3 * u * u - 2 * u * u * u);
    }
    var t1 = o.T - 1;
    if (t < t0 || t > t1) return 0;
    var env = 1, ramp = 0.5;
    if (t < t0 + ramp) env = 0.5 * (1 - Math.cos(Math.PI * (t - t0) / ramp));
    if (t > t1 - ramp) env = 0.5 * (1 - Math.cos(Math.PI * (t1 - t) / ramp));
    return env * A * Math.sin(2 * Math.PI * o.freq * (t - t0));
  }

  function run(model, o) {
    var FzF = P.m * P.g * b / P.L, FzR = P.m * P.g * f / P.L;
    var vx = o.speed / 3.6, dt = 0.005, n = Math.round(o.T / dt) + 1;
    var x = [0, 0, 0, 0, 0];
    var out = { t: [], r: [], ay: [], swa: [], X: [], Y: [], spun: null, lost: null };
    /* rear slip angle at which the Fiala brush model is fully sliding */
    var acR = Math.atan(3 * o.mu * FzR / o.C34), satFrom = null;
    function rhs(t, s) {
      var vy = s[0], r = s[1], psi = s[2];
      var d = steer(t, o) / P.is;
      var af = d - (vy + f * r) / vx, ar = -(vy - b * r) / vx;
      var Ff, Fr;
      if (model === "linear") { Ff = o.C12 * af; Fr = o.C34 * ar; }
      else { Ff = fiala(af, o.C12, FzF, o.mu); Fr = fiala(ar, o.C34, FzR, o.mu); }
      var vyd = (Ff + Fr) / P.m - vx * r;
      return { d: [vyd, (f * Ff - b * Fr) / P.J, r,
        vx * Math.cos(psi) - vy * Math.sin(psi), vx * Math.sin(psi) + vy * Math.cos(psi)],
        ay: vyd + vx * r };
    }
    function add(a, k, h) { return [a[0] + h * k[0], a[1] + h * k[1], a[2] + h * k[2], a[3] + h * k[3], a[4] + h * k[4]]; }
    for (var i = 0; i < n; i++) {
      var t = i * dt, e = rhs(t, x);
      if (i % 4 === 0) {
        out.t.push(t); out.r.push(x[1] * 180 / Math.PI); out.ay.push(e.ay);
        out.swa.push(steer(t, o) * 180 / Math.PI); out.X.push(x[3]); out.Y.push(x[4]);
      }
      if (model !== "linear") {
        var arNow = -(x[0] - b * x[1]) / vx;
        if (Math.abs(arNow) >= acR) { if (satFrom === null) satFrom = t; } else satFrom = null;
      }
      /* call it a spin once body sideslip passes 15 degrees */
      if (Math.abs(x[0]) > Math.tan(15 * Math.PI / 180) * vx || Math.abs(x[1]) > 1.75) {
        out.spun = t; out.lost = satFrom === null ? t : satFrom; break;
      }
      var k1 = e.d, k2 = rhs(t + dt / 2, add(x, k1, dt / 2)).d;
      var k3 = rhs(t + dt / 2, add(x, k2, dt / 2)).d, k4 = rhs(t + dt, add(x, k3, dt)).d;
      for (var j = 0; j < 5; j++) x[j] += dt / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
    }
    return out;
  }

  function niceMax(v, minimum) {
    v = Math.max(v, minimum);
    var steps = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200];
    for (var i = 0; i < steps.length; i++) if (steps[i] >= v * 1.08) return steps[i];
    return Math.ceil(v * 1.1);
  }
  function absMax(arr) { var m = 0; for (var i = 0; i < arr.length; i++) m = Math.max(m, Math.abs(arr[i])); return m; }

  function pathFor(ts, vs, T, lim, H) {
    var d = "";
    for (var i = 0; i < ts.length; i++) {
      var x = ts[i] / T * 1000, y = H / 2 - vs[i] / lim * (H / 2);
      d += (i ? " L" : "M") + x.toFixed(1) + " " + y.toFixed(2);
    }
    return d;
  }

  function el(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function channel(svg, T, lim, series, refLines) {
    var H = 112;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    for (var s = 1; s < T; s++) {
      svg.appendChild(el("line", { "class": "grid", x1: s / T * 1000, x2: s / T * 1000, y1: 0, y2: H, "vector-effect": "non-scaling-stroke" }));
    }
    svg.appendChild(el("line", { "class": "zero", x1: 0, x2: 1000, y1: H / 2, y2: H / 2, "vector-effect": "non-scaling-stroke" }));
    (refLines || []).forEach(function (v) {
      [v, -v].forEach(function (vv) {
        var y = H / 2 - vv / lim * (H / 2);
        svg.appendChild(el("line", { "class": "cursor", x1: 0, x2: 1000, y1: y, y2: y, "vector-effect": "non-scaling-stroke" }));
      });
    });
    series.forEach(function (sr) {
      svg.appendChild(el("path", { "class": sr.cls, d: pathFor(sr.t, sr.v, T, lim, H), "stroke-width": sr.w || 1.8,
        "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke", fill: "none" }));
    });
  }

  function nice(v, list) {
    for (var i = 0; i < list.length; i++) if (list[i] >= v) return list[i];
    return list[list.length - 1];
  }

  /* Top view of both paths. When the path is long and flat (a slalom), the lateral
     axis is stretched by a stated factor so the weave stays visible. Phones get a
     taller drawing; strokes do not scale with the drawing. */
  function trajectory(svg, lin, fia, cap) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var cw = svg.clientWidth || 1000;
    var W = 1000, H = cw < 560 ? 620 : 320, k = W / Math.max(280, cw), pad = 14 * k;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var xs = lin.X.concat(fia.X), ys = lin.Y.concat(fia.Y);
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var spanX = Math.max(1, x1 - x0), spanY = Math.max(0.2, y1 - y0);
    var sx = (W - 2 * pad) / spanX, sy = (H - 2 * pad) / spanY;
    var ex = 1;
    [2, 4, 5, 10].forEach(function (f) { if (sy / sx >= f) ex = f; });
    var scX = ex > 1 ? sx : Math.min(sx, sy), scY = scX * ex;
    var cx = (W - spanX * scX) / 2, cy = (H - spanY * scY) / 2;
    function px(x) { return cx + (x - x0) * scX; }
    function py(y) { return H - (cy + (y - y0) * scY); }
    function d(o) {
      var s = "";
      for (var i = 0; i < o.X.length; i += 2) s += (i ? " L" : "M") + px(o.X[i]).toFixed(1) + " " + py(o.Y[i]).toFixed(1);
      var n = o.X.length - 1;
      return s + " L" + px(o.X[n]).toFixed(1) + " " + py(o.Y[n]).toFixed(1);
    }
    var ns = { "vector-effect": "non-scaling-stroke" };
    function line(a, b, c, e) {
      svg.appendChild(el("line", Object.assign({ "class": "grid", x1: a, y1: b, x2: c, y2: e, "stroke-width": 1 }, ns)));
    }
    var gx = nice(spanX / (cw < 560 ? 5 : 10), [5, 10, 20, 25, 50, 100, 200, 500]);
    var gy = ex > 1 ? nice(spanY / 4, [0.5, 1, 2, 5, 10, 20, 50]) : gx;
    for (var a = Math.ceil((x0 - cx / scX) / gx) * gx; px(a) <= W; a += gx) if (px(a) >= 0) line(px(a), 0, px(a), H);
    for (var b2 = Math.ceil((y0 - cy / scY) / gy) * gy; py(b2) >= 0; b2 += gy) if (py(b2) <= H) line(0, py(b2), W, py(b2));
    svg.appendChild(el("path", Object.assign({ "class": "lin", d: d(lin), "stroke-width": 2.2, fill: "none", "stroke-linejoin": "round" }, ns)));
    svg.appendChild(el("path", Object.assign({ "class": "fia", d: d(fia), "stroke-width": 2.2, fill: "none", "stroke-dasharray": "8 6" }, ns)));
    svg.appendChild(el("circle", Object.assign({ "class": "steer", cx: px(0), cy: py(0), r: 4.5 * k, "stroke-width": 2, fill: "none" }, ns)));
    if (fia.spun !== null) {
      var n = fia.X.length - 1, ax = px(fia.X[n]), ay = py(fia.Y[n]), m = 6 * k;
      svg.appendChild(el("path", Object.assign({ "class": "fia", "stroke-width": 2.4, d: "M" + (ax - m) + " " + (ay - m) + " L" + (ax + m) + " " + (ay + m) +
        " M" + (ax - m) + " " + (ay + m) + " L" + (ax + m) + " " + (ay - m) }, ns)));
    }
    if (cap) {
      cap.textContent = "Top view from the start circle. Grid " + gx + " m" +
        (ex > 1 ? " along and " + gy + " m across; the lateral scale is stretched ×" + ex + "." : ".") +
        (fia.spun !== null ? " × marks where the Fiala car spins." : "");
    }
  }

  var form = root.querySelector("[data-sim-controls]");
  var outs = {
    speed: root.querySelector("#sim-speed-out"), amp: root.querySelector("#sim-amp-out"),
    freq: root.querySelector("#sim-freq-out"), mu: root.querySelector("#sim-mu-out")
  };
  var svgs = { swa: root.querySelector("[data-ch=swa] svg"), r: root.querySelector("[data-ch=r] svg"),
    ay: root.querySelector("[data-ch=ay] svg"), traj: root.querySelector("[data-traj] svg") };
  var reads = { sw: root.querySelector("[data-read=sw]"), rl: root.querySelector("[data-read=rl]"), rf: root.querySelector("[data-read=rf]"),
    al: root.querySelector("[data-read=al]"), af: root.querySelector("[data-read=af]"),
    ranges: root.querySelectorAll("[data-range]"), axis: root.querySelector("[data-axis]") };
  var note = root.querySelector("[data-sim-note]");
  var trajCap = root.querySelector("[data-traj-cap]");

  function opts() {
    var man = form.querySelector("input[name=man]:checked").value;
    var cs = form.querySelector("#sim-cs").value.split(",");
    return {
      man: man, speed: +form.querySelector("#sim-speed").value, amp: +form.querySelector("#sim-amp").value,
      freq: +form.querySelector("#sim-freq").value, mu: +form.querySelector("#sim-mu").value,
      C12: +cs[0] * 1000, C34: +cs[1] * 1000, T: man === "step" ? 6 : 8
    };
  }

  var queued = false;
  function update() {
    queued = false;
    var o = opts();
    outs.speed.textContent = o.speed + " km/h";
    outs.amp.textContent = o.amp + "°";
    outs.freq.textContent = o.freq.toFixed(2) + " Hz";
    outs.mu.textContent = o.mu.toFixed(2);
    root.querySelectorAll("[data-slalom-only]").forEach(function (n) { n.hidden = o.man !== "slalom"; });

    var lin = run("linear", o), fia = run("fiala", o);
    var swaLim = niceMax(absMax(lin.swa), 20);
    var rLim = niceMax(Math.max(absMax(lin.r), absMax(fia.r)), 5);
    var aLim = niceMax(Math.max(absMax(lin.ay), absMax(fia.ay), o.mu * P.g), 5);
    channel(svgs.swa, o.T, swaLim, [{ cls: "steer", t: lin.t, v: lin.swa, w: 1.6 }]);
    channel(svgs.r, o.T, rLim, [{ cls: "lin", t: lin.t, v: lin.r }, { cls: "fia", t: fia.t, v: fia.r }]);
    channel(svgs.ay, o.T, aLim, [{ cls: "lin", t: lin.t, v: lin.ay }, { cls: "fia", t: fia.t, v: fia.ay }], [o.mu * P.g]);
    trajectory(svgs.traj, lin, fia, trajCap);
    reads.ranges[0].textContent = "±" + swaLim;
    reads.ranges[1].textContent = "±" + rLim;
    reads.ranges[2].textContent = "±" + aLim;
    if (reads.axis) {
      var spans = reads.axis.querySelectorAll("span");
      spans.forEach(function (s, i) { s.textContent = i === spans.length - 1 ? o.T + " s" : (i === 0 ? "0 s" : String(Math.round(i * o.T / (spans.length - 1) * 10) / 10)); });
    }
    if (reads.sw) reads.sw.textContent = absMax(lin.swa).toFixed(0) + "°";
    reads.rl.textContent = absMax(lin.r).toFixed(1);
    reads.rf.textContent = absMax(fia.r).toFixed(1);
    reads.al.textContent = absMax(lin.ay).toFixed(2);
    reads.af.textContent = absMax(fia.ay).toFixed(2);

    var msg;
    if (fia.spun !== null) {
      msg = "The Fiala model loses the rear axle at t = " + fia.lost.toFixed(2) + " s and spins (the trace stops once the body slip angle passes 15°). The linear tire never saturates, so it carries on.";
    } else {
      var gap = absMax(lin.ay) > 0.1 ? (1 - absMax(fia.ay) / absMax(lin.ay)) * 100 : 0;
      msg = gap >= 6
        ? "The Fiala tire saturates: its peak lateral acceleration is " + gap.toFixed(0) + " % below the linear prediction. The dashed lines mark μg = " + (o.mu * P.g).toFixed(1) + " m/s²."
        : "Both tire models agree to within " + Math.max(1, Math.ceil(gap)) + " %: at this speed and steering input the tires stay close to their linear range.";
    }
    note.textContent = msg;
  }
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(update); } }
  form.addEventListener("input", schedule);
  form.addEventListener("change", schedule);
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  var lastW = 0;
  window.addEventListener("resize", function () {
    var w = svgs.traj.clientWidth;
    if ((w < 560) !== (lastW < 560) || Math.abs(w - lastW) > 80) { lastW = w; schedule(); }
  });
  lastW = svgs.traj.clientWidth;
  update();
})();
