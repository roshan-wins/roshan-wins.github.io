/* Theme toggle and copy buttons. Theme: follows the system until the visitor
   picks one; the choice is remembered in this browser only. */
(function () {
  var root = document.documentElement;
  var KEY = "rkp-theme";
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function current() {
    var t = root.getAttribute("data-theme");
    if (t === "dark" || t === "light") return t;
    return mq && mq.matches ? "dark" : "light";
  }

  function announce() {
    try { document.dispatchEvent(new CustomEvent("themechange", { detail: current() })); } catch (e) {}
  }

  function sync() {
    var dark = current() === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      b.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
      b.setAttribute("title", dark ? "Light theme" : "Dark theme");
    });
  }

  function apply(t) {
    root.setAttribute("data-theme", t);
    try { localStorage.setItem(KEY, t); } catch (e) {}
    sync();
    announce();
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-theme-toggle]") : null;
    if (t) { apply(current() === "dark" ? "light" : "dark"); return; }

    var c = e.target.closest ? e.target.closest("[data-copy]") : null;
    if (!c) return;
    var text = c.getAttribute("data-copy");
    var status = document.getElementById(c.getAttribute("data-copy-status") || "");
    function done(msg) { if (status) status.textContent = msg; }
    function fallback() {
      var target = document.getElementById(c.getAttribute("data-copy-target") || "");
      if (target && window.getSelection) {
        var range = document.createRange();
        range.selectNodeContents(target);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        done("Selected. Press Ctrl+C or Cmd+C to copy.");
      } else {
        done(text);
      }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done("Copied " + text); }, fallback);
      } else {
        fallback();
      }
    } catch (err) { fallback(); }
  });

  if (mq) {
    var onChange = function () { if (!root.getAttribute("data-theme")) { sync(); announce(); } };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
  sync();
})();

/* Read a CSS custom property from the root, for canvas and SVG drawing code. */
window.rkpToken = function (name, fallback) {
  try {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch (e) { return fallback; }
};

/* local time in each city of the About section */
(function () {
  var els = document.querySelectorAll("time[data-tz]");
  if (!els.length || !window.Intl) return;
  function tick() {
    els.forEach(function (el) {
      try {
        var f = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: el.getAttribute("data-tz") });
        el.textContent = f.format(new Date());
      } catch (e) { el.textContent = ""; }
    });
  }
  tick(); setInterval(tick, 30000);
})();
