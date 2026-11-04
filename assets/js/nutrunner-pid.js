/* Nutrunner speed control, after the MF2030 brief: a DC motor (Faulhaber 4490 036 B, 36 V,
   motor 4 in the brief's list) drives the nut through two planetary stages (n = 20, from the
   stall torque and the tool's 55 N·m), a compliant transmission (k = 739 N·m/rad, d = 1.5 N·m·s/rad)
   and a nut with linear friction (1.5 N·m·s/rad). The PID runs at 1 kHz with one sample of delay,
   so high gains ring the way a real digital controller does. Tightening adds an M8 class 8.8 bolt
   (1.25 mm pitch, 100 mm grip) with thread friction and switches the motor off at the target. */
(function () {
  "use strict";
  var root = document.querySelector("[data-pid]");
  if (!root) return;
  var NS = "http://www.w3.org/2000/svg";

  var R = 0.44, KM = 0.0338, KE = 0.0338, JR = 130e-7, BM = 7.72e-7 * 60 / (2 * Math.PI);
  var N = 20, J1 = JR + 6.5e-8 + 5.3e-8 / N, J2 = 4.0e-5, KT = 739, DT = 1.5, DJ = 1.5, U = 36;
  var E = 210e9, A = Math.PI / 4 * 0.008 * 0.008, LG = 0.1, P = 1.25e-3;
  var KAX = E * A / LG, KTH = KAX * Math.pow(P / (2 * Math.PI), 2), RS = 0.004, FY = 640e6 * 36.6e-6;

  function run(o) {
    var h = 2e-5, Ts = 1e-3, step = Math.round(Ts / h), every = Math.round(0.004 / h);
    var T = o.mode === "tight" ? 1.6 : 3.2, n = Math.round(T / h);
    var x0 = 0, x1 = 0, w1 = 0, w2 = 0, I = 0, u = 0, upend = 0, prev = 0, off = false, offAt = null;
    var out = { t: [], ref: [], w: [], u: [], i: [], tq: [], F: 0, tpk: 0, ipk: 0 };
    function ref(t) {
      if (o.mode === "tight") return 3 * Math.min(1, t / 0.05);
      if (t < 2.85) return o.wr * Math.min(1, t / 0.15);
      return Math.max(0, o.wr * (3 - t) / 0.15);
    }
    for (var k = 0; k < n; k++) {
      var t = k * h;
      var Ttr = KT * (x0 / N - x1) + DT * (w1 / N - w2);
      if (k % step === 0) {
        u = upend;                                    // apply the previous sample's output
        var meas = w1 / N, e = ref(t) - meas;          // speed measured at the motor, scaled to the nut
        var d = (meas - prev) / Ts; prev = meas;
        var un = o.kp * e + I - o.kd * d;
        var us = Math.max(-U, Math.min(U, un));
        if (!(us !== un && e * un > 0)) I += o.ki * e * Ts;   // anti-windup: hold the integral in saturation
        upend = us;
        if (o.mode === "tight" && !off && Ttr >= o.target) { off = true; offAt = t; }
      }
      var uu = off ? KE * w1 : u;
      var i = (uu - KE * w1) / R, Tm = KM * i, Tb = 0, F = 0;
      if (o.mode === "tight") { var th = Math.max(x1, 0); F = KAX * P * th / (2 * Math.PI); Tb = KTH * th + o.mu * F * RS; }
      var a1 = (Tm - BM * w1 - Ttr / N) / J1, a2 = (Ttr - DJ * w2 - Tb) / J2;
      x0 += w1 * h; x1 += w2 * h; w1 += a1 * h; w2 += a2 * h;
      if (o.mode === "tight" && w2 < 0) w2 = 0;       // the thread is self-locking: the nut does not unwind
      if (Ttr > out.tpk) out.tpk = Ttr;
      if (F > out.F) out.F = F;
      if (Math.abs(i) > out.ipk) out.ipk = Math.abs(i);
      if (k % every === 0) { out.t.push(t); out.ref.push(ref(t)); out.w.push(w2); out.u.push(uu); out.i.push(i); out.tq.push(Ttr); }
      if (!isFinite(w2) || Math.abs(w2) > 1e4) { out.blow = true; break; }
    }
    out.T = T; out.offAt = offAt; out.angle = x1;
    return out;
  }

  function el(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function plot(svg, T, lo, hi, series, refs) {
    var W = 1000, H = 112;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    for (var s = T / 4; s < T - 1e-9; s += T / 4) svg.appendChild(el("line", { "class": "grid", x1: s / T * W, x2: s / T * W, y1: 0, y2: H, "vector-effect": "non-scaling-stroke" }));
    function Y(v) { return H - (v - lo) / (hi - lo) * H; }
    if (lo < 0 && hi > 0) svg.appendChild(el("line", { "class": "zero", x1: 0, x2: W, y1: Y(0), y2: Y(0), "vector-effect": "non-scaling-stroke" }));
    (refs || []).forEach(function (v) {
      svg.appendChild(el("line", { "class": "cursor", x1: 0, x2: W, y1: Y(v), y2: Y(v), "vector-effect": "non-scaling-stroke" }));
    });
    series.forEach(function (sr) {
      var d = "";
      for (var i = 0; i < sr.t.length; i++) {
        var v = Math.max(lo - (hi - lo), Math.min(hi + (hi - lo), sr.v[i]));
        d += (i ? " L" : "M") + (sr.t[i] / T * W).toFixed(1) + " " + Y(v).toFixed(2);
      }
      svg.appendChild(el("path", { "class": sr.cls, d: d, "stroke-width": sr.w || 1.8, fill: "none", "stroke-linejoin": "round",
        "vector-effect": "non-scaling-stroke", "stroke-dasharray": sr.dash || "none" }));
    });
  }
  function nice(v, list) { for (var i = 0; i < list.length; i++) if (list[i] >= v) return list[i]; return list[list.length - 1]; }
  function absMax(a) { var m = 0; for (var i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); return m; }

  var q = function (s) { return root.querySelector(s); };
  var form = q("[data-pid-controls]");
  var ids = ["kp", "ki", "kd", "target", "mu"];
  var outs = {}; ids.forEach(function (k) { outs[k] = q("#pid-" + k + "-out"); });
  var svgs = { w: q("[data-pch=w] svg"), u: q("[data-pch=u] svg"), x: q("[data-pch=x] svg") };
  var rd = {}; root.querySelectorAll("[data-pr]").forEach(function (e) { rd[e.getAttribute("data-pr")] = e; });
  var note = q("[data-pid-note]"), axis = q("[data-pid-axis]");

  function opts() {
    return { mode: form.querySelector("input[name=pid-mode]:checked").value,
      kp: +q("#pid-kp").value, ki: +q("#pid-ki").value, kd: +q("#pid-kd").value,
      target: +q("#pid-target").value, mu: +q("#pid-mu").value, wr: 10 };
  }
  function fmt(v, d) { return v.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }); }

  var queued = false;
  function update() {
    queued = false;
    var o = opts();
    outs.kp.textContent = fmt(o.kp, 1); outs.ki.textContent = fmt(o.ki, 0); outs.kd.textContent = fmt(o.kd, 3);
    outs.target.textContent = fmt(o.target, 0) + " N·m"; outs.mu.textContent = fmt(o.mu, 2);
    root.querySelectorAll("[data-tight-only]").forEach(function (n) { n.hidden = o.mode !== "tight"; });
    root.querySelectorAll("[data-run-only]").forEach(function (n) { n.hidden = o.mode === "tight"; });
    var r = run(o), T = r.T;
    var wHi = o.mode === "tight" ? 6 : nice(Math.max(12, absMax(r.w) * 1.05), [12, 15, 20, 30, 50, 100]);
    plot(svgs.w, T, o.mode === "tight" ? 0 : -wHi * 0.25, wHi, [
      { cls: "steer", t: r.t, v: r.ref, w: 1.4, dash: "5 4" }, { cls: "lin", t: r.t, v: r.w, w: 2 }]);
    plot(svgs.u, T, -40, 40, [{ cls: "fia", t: r.t, v: r.u, w: 1.8 }], [36, -36]);
    var iHi = nice(absMax(r.i) * 1.1, [10, 20, 30, 50, 80, 120, 200]);
    if (o.mode === "tight") {
      plot(svgs.x, T, 0, Math.max(30, o.target * 1.2), [{ cls: "lin", t: r.t, v: r.tq, w: 2 }], [o.target]);
      q("[data-pch=x] [data-plabel]").innerHTML = "<b>Torque at the nut</b><span>N·m, target dashed</span>";
    } else {
      plot(svgs.x, T, -iHi, iHi, [{ cls: "lin", t: r.t, v: r.i, w: 1.6 }]);
      q("[data-pch=x] [data-plabel]").innerHTML = "<b>Motor current</b><span>A, ±" + iHi + "</span>";
    }
    q("[data-pch=w] [data-prange]").textContent = o.mode === "tight" ? "0 to 6" : "up to " + wHi;
    if (axis) {
      var sp = axis.querySelectorAll("span");
      sp.forEach(function (s, i) { var v = T * i / (sp.length - 1); s.textContent = i === sp.length - 1 ? fmt(v, 1) + " s" : (i === 0 ? "0 s" : fmt(v, 1)); });
    }
    // readouts
    var mid = [], ramp = 0;
    for (var i = 0; i < r.t.length; i++) {
      if (o.mode !== "tight" && r.t[i] > 1 && r.t[i] < 2.8) mid.push(r.ref[i] - r.w[i]);
      if (o.mode === "tight" && r.t[i] > 0.2 && (r.offAt === null || r.t[i] < r.offAt)) mid.push(r.ref[i] - r.w[i]);
      if (r.t[i] < 0.6) ramp = Math.max(ramp, Math.abs(r.ref[i] - r.w[i]));
    }
    var ss = mid.length ? mid.reduce(function (a, b) { return a + b; }, 0) / mid.length : 0;
    var osc = mid.length ? Math.sqrt(mid.reduce(function (a, b) { return a + (b - ss) * (b - ss); }, 0) / mid.length) : 0;
    rd.ss.textContent = fmt(ss, 2) + " rad/s";
    rd.ipk.textContent = fmt(r.ipk, 0) + " A";
    rd.upk.textContent = fmt(absMax(r.u), 1) + " V";
    if (o.mode === "tight") {
      rd.tq.textContent = fmt(r.tpk, 1) + " N·m";
      rd.F.textContent = fmt(r.F / 1000, 1) + " kN";
      rd.F.classList.toggle("is-bad", r.F > FY);
    }
    var msg;
    if (r.blow || (o.mode !== "tight" && (osc > 1.5 || (Math.abs(ss) > 3 && o.ki > 0)))) {
      msg = "Too much gain for a controller that samples at 1 kHz: the speed rings, the voltage slams between ±36 V and the current spikes. Lower K_p or K_i.";
    } else if (o.mode === "tight") {
      msg = r.offAt === null ? "The tool never reached " + fmt(o.target, 0) + " N·m in the time shown." :
        "Motor off at " + fmt(r.offAt, 2) + " s with " + fmt(r.tpk, 1) + " N·m at the nut, after " + fmt(r.angle * 180 / Math.PI, 0) + "° of nut rotation. Bolt tension " + fmt(r.F / 1000, 1) + " kN: " +
        (r.F > FY ? "above the bolt's yield load of about " + fmt(FY / 1000, 1) + " kN. This target is too high, which is the case the brief's last task asks you to fix by lowering it." :
          "below the yield load of about " + fmt(FY / 1000, 1) + " kN.");
    } else if (o.ki === 0) {
      msg = "With proportional gain only, the nut runs " + fmt(ss, 1) + " rad/s slow: friction needs a steady voltage, and a P controller only makes voltage from error. Add some K_i.";
    } else {
      msg = "The nut follows the speed profile with " + fmt(Math.abs(ss), 2) + " rad/s steady error and lags by up to " + fmt(ramp, 1) + " rad/s while it speeds up.";
    }
    note.textContent = msg;
  }
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(update); } }
  form.addEventListener("input", schedule); form.addEventListener("change", schedule);
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  var reset = q("[data-pid-reset]");
  if (reset) reset.addEventListener("click", function () {
    q("#pid-kp").value = 2; q("#pid-ki").value = 40; q("#pid-kd").value = 0; schedule();
  });
  update();
})();
