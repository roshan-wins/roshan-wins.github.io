/* Home page: project filters, register previews, counting numbers, scroll reveals,
   the Chennai–Stockholm time difference and a small tilt on the RX-135.
   Everything here is an extra: the page reads the same without it. */
(function () {
  "use strict";
  var mm = window.matchMedia ? function (q) { return window.matchMedia(q).matches; } : function () { return false; };
  var reduce = mm("(prefers-reduced-motion: reduce)");
  var fine = mm("(hover: hover) and (pointer: fine)");
  var KINDS = ["design", "dynamics", "flow"];

  /* ---------- filters: All / Design and build / Vehicle dynamics and control / Flow and heat ---------- */
  var work = document.getElementById("work");
  if (work) {
    var chips = work.querySelectorAll("[data-filter]");
    var grid = work.querySelector(".feat-grid"), regWrap = work.querySelector(".register");
    var apply = function (id, scroll) {
      if (KINDS.indexOf(id) < 0) id = "all";
      chips.forEach(function (c) { c.setAttribute("aria-pressed", c.getAttribute("data-filter") === id ? "true" : "false"); });
      var nf = 0, nr = 0;
      work.querySelectorAll(".feat").forEach(function (el) {
        var on = id === "all" || el.getAttribute("data-disc") === id; el.hidden = !on; if (on) nf++;
      });
      work.querySelectorAll(".reg__row").forEach(function (el) {
        var on = id === "all" || el.getAttribute("data-disc") === id; el.hidden = !on; if (on) nr++;
      });
      if (grid) grid.hidden = nf === 0;
      if (regWrap) regWrap.hidden = nr === 0;
      if (scroll) work.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    };
    chips.forEach(function (c) {
      c.addEventListener("click", function () {
        var id = c.getAttribute("data-filter");
        apply(id, false);
        try { history.replaceState(null, "", id === "all" ? "#work" : "#" + id); } catch (e) {}
      });
    });
    var fromHash = function () {
      var h = (location.hash || "").slice(1);
      if (KINDS.indexOf(h) >= 0) apply(h, true);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
  }

  /* ---------- register: a preview follows the pointer ---------- */
  var reg = document.querySelector(".reg");
  if (reg && fine) {
    var box = document.createElement("div");
    box.className = "reg-preview"; box.setAttribute("aria-hidden", "true");
    document.body.appendChild(box);
    var cur = null;
    var place = function (e) {
      var w = box.offsetWidth || 300, h = box.offsetHeight || 190;
      var x = e.clientX + 28, y = e.clientY - h / 2;
      if (x + w > window.innerWidth - 12) x = e.clientX - w - 28;
      y = Math.max(12, Math.min(window.innerHeight - h - 12, y));
      box.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    };
    reg.addEventListener("pointermove", function (e) {
      var row = e.target.closest ? e.target.closest(".reg__row") : null;
      if (!row) { box.classList.remove("is-on"); cur = null; return; }
      if (row !== cur) {
        cur = row;
        var t = row.querySelector("template");
        box.innerHTML = "";
        if (t && t.content) box.appendChild(t.content.cloneNode(true));
        box.setAttribute("data-disc", row.getAttribute("data-disc") || "");
        box.classList.toggle("has-photo", !!box.querySelector("img"));
        box.classList.add("is-on");
      }
      place(e);
    });
    reg.addEventListener("pointerleave", function () { box.classList.remove("is-on"); cur = null; });
    window.addEventListener("scroll", function () { box.classList.remove("is-on"); cur = null; }, { passive: true });
  }

  /* ---------- numbers count to their value once they are on screen ---------- */
  var counters = document.querySelectorAll("[data-count-to]");
  if (counters.length && !reduce && "IntersectionObserver" in window) {
    var run = function (el) {
      var a = +el.getAttribute("data-count-from"), b = +el.getAttribute("data-count-to"), t0 = 0, dur = 1300;
      var step = function (t) {
        if (!t0) t0 = t;
        var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = String(Math.round(a + (b - a) * e));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) { if (en.isIntersecting) { run(en.target); io.unobserve(en.target); } });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { el.textContent = el.getAttribute("data-count-from"); io.observe(el); });
  }

  /* ---------- sections ease in as they arrive ---------- */
  var rv = document.querySelectorAll("[data-reveal]");
  if (rv.length && !reduce && "IntersectionObserver" in window) {
    var vh = window.innerHeight || 800;
    var io2 = new IntersectionObserver(function (es) {
      es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("is-in"); io2.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -6% 0px" });
    rv.forEach(function (el) {
      // anything already on screen at load stays put; only what is below the fold animates
      if (el.getBoundingClientRect().top < vh * 0.94) el.classList.add("is-in");
      else io2.observe(el);
    });
    document.documentElement.classList.add("reveal-on");
  }

  /* ---------- SVG animations stand still for reduced motion ---------- */
  if (reduce) {
    document.querySelectorAll("svg").forEach(function (s) {
      try { if (s.querySelector("animateMotion")) { s.pauseAnimations(); s.setCurrentTime(4.9); } } catch (e) {}
    });
  }

  /* ---------- how far ahead Chennai is, today (daylight saving moves it) ---------- */
  var diff = document.querySelector("[data-tz-diff]");
  if (diff && window.Intl) {
    try {
      var p = diff.getAttribute("data-tz-diff").split("|");
      var offset = function (tz) {
        var d = new Date(), parts = {};
        new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit" }).formatToParts(d).forEach(function (x) { parts[x.type] = x.value; });
        var asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
        return Math.round((asUtc - Math.floor(d.getTime() / 60000) * 60000) / 60000);
      };
      var m = offset(p[0]) - offset(p[1]);
      if (!isNaN(m) && m !== 0) {
        var h = Math.floor(Math.abs(m) / 60), mi = Math.abs(m) % 60;
        diff.textContent = (m > 0 ? p[2] : p[3]) + " is " + h + " h" + (mi ? " " + mi + " min" : "") + " ahead of " +
          (m > 0 ? p[3] : p[2]) + " today.";
      }
    } catch (e) {}
  }

  /* ---------- the bike leans a little towards the pointer ---------- */
  var bike = document.querySelector("[data-tilt]");
  if (bike && fine && !reduce) {
    bike.addEventListener("pointermove", function (e) {
      var r = bike.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      bike.style.setProperty("--rx", (-y * 6).toFixed(2) + "deg");
      bike.style.setProperty("--ry", (x * 9).toFixed(2) + "deg");
    });
    bike.addEventListener("pointerleave", function () {
      bike.style.setProperty("--rx", "0deg"); bike.style.setProperty("--ry", "0deg");
    });
  }
})();
