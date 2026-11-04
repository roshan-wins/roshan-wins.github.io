/* Steer-by-wire road-wheel actuator: how angle and torque scale through the chain
   motor -> worm gear (i_w = 20) -> recirculating-ball gear -> steering gear (i_s = 20)
   -> pitman arm -> drag link. Ideal relations from the model report (eqs. 1-4);
   friction and compliance are left out here, as the text says. */
(function () {
  var root = document.querySelector("[data-chain]");
  if (!root) return;
  var IW = 20, IS = 20, TMAX = 20;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ang = root.querySelector("#chain-angle"), trq = root.querySelector("#chain-torque");
  var outAng = root.querySelector("#chain-angle-out"), outTrq = root.querySelector("#chain-torque-out");
  var play = root.querySelector("[data-chain-play]");
  var parts = {
    motor: root.querySelector("[data-rot=motor]"), wheel: root.querySelector("[data-rot=worm]"),
    ja: root.querySelector("[data-rot=ja]"), jb: root.querySelector("[data-rot=jb]"),
    sector: root.querySelector("[data-rot=sector]"), pitman: root.querySelector("[data-rot=pitman]"),
    drag: root.querySelector("[data-drag]"), road: root.querySelector("[data-rot=road]")
  };
  var cells = {};
  root.querySelectorAll("[data-cell]").forEach(function (c) { cells[c.getAttribute("data-cell")] = c; });

  function rot(node, deg) {
    if (!node) return;
    var c = node.getAttribute("data-c").split(",");
    node.setAttribute("transform", "rotate(" + deg.toFixed(2) + " " + c[0] + " " + c[1] + ")");
  }
  function fmt(v, d) { return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }); }

  function render(thetaP) {
    var tp = thetaP, tb = tp * IS, tm = tb * IW;
    rot(parts.motor, tm % 360);
    rot(parts.wheel, -(tb % 360));
    rot(parts.ja, tb % 360);
    rot(parts.jb, tb % 360);
    rot(parts.sector, -tp);
    rot(parts.pitman, -tp);
    rot(parts.road, -tp);
    if (parts.drag) {
      // parallelogram linkage: pitman arm and steering arm both hang down at rest
      var s = Math.sin(tp * Math.PI / 180), c = Math.cos(tp * Math.PI / 180);
      var pv = parts.pitman.getAttribute("data-c").split(",").map(Number);
      var kp = parts.road.getAttribute("data-c").split(",").map(Number);
      var R = +parts.drag.getAttribute("data-r");
      parts.drag.setAttribute("x1", (pv[0] + R * s).toFixed(1));
      parts.drag.setAttribute("y1", (pv[1] + R * c).toFixed(1));
      parts.drag.setAttribute("x2", (kp[0] + R * s).toFixed(1));
      parts.drag.setAttribute("y2", (kp[1] + R * c).toFixed(1));
    }
    var tmCmd = +trq.value, tmSat = Math.max(-TMAX, Math.min(TMAX, tmCmd));
    outAng.textContent = (tp > 0 ? "+" : "") + fmt(tp, 1) + "°";
    outTrq.textContent = fmt(tmCmd, 1) + " N·m";
    cells["m-ang"].textContent = fmt(tm, 0) + "°";
    cells["m-rev"].textContent = fmt(tm / 360, 1) + " turns";
    cells["m-trq"].textContent = fmt(tmSat, 1) + " N·m" + (Math.abs(tmCmd) > TMAX ? ", saturated" : "");
    cells["b-ang"].textContent = fmt(tb, 1) + "°";
    cells["b-trq"].textContent = fmt(tmSat * IW, 0) + " N·m";
    cells["p-ang"].textContent = fmt(tp, 1) + "°";
    cells["p-trq"].textContent = fmt(tmSat * IW * IS, 0) + " N·m";
  }

  var anim = null;
  function stop() { if (anim) cancelAnimationFrame(anim); anim = null; play.textContent = "Play a steering sweep"; play.setAttribute("aria-pressed", "false"); }
  function start() {
    var t0 = performance.now();
    play.textContent = "Stop the sweep";
    play.setAttribute("aria-pressed", "true");
    function step(now) {
      var t = (now - t0) / 1000;
      var v = 30 * Math.sin(2 * Math.PI * t / 6);
      ang.value = v.toFixed(1);
      render(v);
      anim = requestAnimationFrame(step);
    }
    anim = requestAnimationFrame(step);
  }
  play.addEventListener("click", function () { if (anim) stop(); else start(); });
  if (reduce) play.hidden = true;
  ang.addEventListener("input", function () { if (anim) stop(); render(+ang.value); });
  trq.addEventListener("input", function () { render(+ang.value); });
  render(+ang.value);
})();
