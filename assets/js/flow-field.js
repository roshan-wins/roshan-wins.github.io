/* Streamlines from a precomputed inviscid panel-method solution, drawn on canvas
   in the page's theme colours (blue = slower than the free stream, red = faster).
   Particles move along each line at the local speed; they stay still for visitors
   who prefer reduced motion, and pause when the canvas is off screen. */
(function () {
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function hexToRgb(h, fb) {
    h = (h || "").trim();
    var m = /^#?([0-9a-f]{6})$/i.exec(h);
    if (!m) return fb;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function rgb(c, a) {
    return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + a + ")";
  }

  function FlowField(canvas, data) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.d = data;
    this.mirror = canvas.getAttribute("data-mirror") === "true";
    this.particles = [];
    this.running = false;
    this.visible = true;
    this.prepare();
    this.colours();
    this.resize();
  }

  FlowField.prototype.prepare = function () {
    var lines = this.d.lines;
    this.lines = lines.map(function (ln) {
      var s = [0];
      for (var i = 1; i < ln.x.length; i++) {
        var dx = ln.x[i] - ln.x[i - 1], dy = ln.y[i] - ln.y[i - 1];
        s.push(s[i - 1] + Math.sqrt(dx * dx + dy * dy));
      }
      return { x: ln.x, y: ln.y, v: ln.v, s: s, len: s[s.length - 1] };
    });
    var n = Math.min(260, this.lines.length * 12);
    for (var k = 0; k < n; k++) {
      var li = k % this.lines.length;
      this.particles.push({ li: li, s: Math.random() * this.lines[li].len });
    }
  };

  FlowField.prototype.colours = function () {
    var tok = window.rkpToken || function (n, f) { return f; };
    this.cool = hexToRgb(tok("--cool", "#3346b8"), [51, 70, 184]);
    this.warm = hexToRgb(tok("--warm", "#b8122f"), [184, 18, 47]);
    this.mid = hexToRgb(tok("--flow-mid", "#aab3bc"), [170, 179, 188]);
    this.ink = tok("--line", "#121a22");
    this.bg = tok("--bg", "#f5f7f8");
  };

  FlowField.prototype.colourFor = function (v) {
    var band = 0.035, lo = 0.66, hi = 1.42;
    if (Math.abs(v - 1) < band) return this.mid;
    if (v < 1) return mix(this.mid, this.cool, Math.min(1, Math.pow((1 - band - v) / (1 - band - lo), 0.8)));
    return mix(this.mid, this.warm, Math.min(1, Math.pow((v - 1 - band) / (hi - 1 - band), 0.8)));
  };

  FlowField.prototype.resize = function () {
    var r = this.c.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var b = this.d.bounds;
    var w = Math.max(320, r.width);
    var h = w * (b[3] - b[2]) / (b[1] - b[0]);
    this.c.width = Math.round(w * dpr);
    this.c.height = Math.round(h * dpr);
    this.scale = (w / (b[1] - b[0])) * dpr;
    this.dpr = dpr;
    this.draw(0);
  };

  FlowField.prototype.X = function (x) { return (x - this.d.bounds[0]) * this.scale; };
  FlowField.prototype.Y = function (y) {
    var yy = this.mirror ? -y : y;
    return (this.d.bounds[3] - yy) * this.scale;
  };

  FlowField.prototype.at = function (ln, s) {
    var lo = 0, hi = ln.s.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (ln.s[mid] < s) lo = mid; else hi = mid; }
    var t = (s - ln.s[lo]) / Math.max(1e-9, ln.s[hi] - ln.s[lo]);
    return {
      x: ln.x[lo] + (ln.x[hi] - ln.x[lo]) * t,
      y: ln.y[lo] + (ln.y[hi] - ln.y[lo]) * t,
      v: ln.v[lo] + (ln.v[hi] - ln.v[lo]) * t
    };
  };

  FlowField.prototype.draw = function (dt) {
    var ctx = this.ctx, self = this;
    ctx.clearRect(0, 0, this.c.width, this.c.height);
    ctx.lineCap = "round";
    ctx.lineWidth = 1.15 * this.dpr;
    this.lines.forEach(function (ln) {
      for (var i = 1; i < ln.x.length; i++) {
        ctx.strokeStyle = rgb(self.colourFor(0.5 * (ln.v[i] + ln.v[i - 1])), 0.95);
        ctx.beginPath();
        ctx.moveTo(self.X(ln.x[i - 1]), self.Y(ln.y[i - 1]));
        ctx.lineTo(self.X(ln.x[i]), self.Y(ln.y[i]));
        ctx.stroke();
      }
    });
    if (!reduce) {
      ctx.lineWidth = 2.6 * this.dpr;
      var base = 0.22; // chords per second at free-stream speed
      this.particles.forEach(function (p) {
        var ln = self.lines[p.li];
        var a = self.at(ln, p.s);
        p.s += dt * base * a.v;
        if (p.s > ln.len) p.s -= ln.len;
        var tail = self.at(ln, Math.max(0, p.s - 0.035 * a.v));
        var head = self.at(ln, p.s);
        ctx.strokeStyle = rgb(self.colourFor(head.v), 1);
        ctx.beginPath();
        ctx.moveTo(self.X(tail.x), self.Y(tail.y));
        ctx.lineTo(self.X(head.x), self.Y(head.y));
        ctx.stroke();
      });
    }
    var af = this.d.airfoil;
    ctx.beginPath();
    for (var i = 0; i < af.x.length; i++) {
      var px = this.X(af.x[i]), py = this.Y(af.y[i]);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = this.bg;
    ctx.fill();
    ctx.lineWidth = 1.6 * this.dpr;
    ctx.strokeStyle = this.ink;
    ctx.stroke();
  };

  FlowField.prototype.loop = function () {
    var self = this, last = performance.now();
    if (reduce || this.running) return;
    this.running = true;
    function frame(now) {
      if (!self.running) return;
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (self.visible && !document.hidden) self.draw(dt);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  function boot(canvas) {
    var src = canvas.getAttribute("data-flow");
    fetch(src).then(function (r) { return r.json(); }).then(function (data) {
      var ff = new FlowField(canvas, data);
      if ("ResizeObserver" in window) new ResizeObserver(function () { ff.resize(); }).observe(canvas);
      else window.addEventListener("resize", function () { ff.resize(); });
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (es) { ff.visible = es[0].isIntersecting; }).observe(canvas);
      }
      document.addEventListener("themechange", function () { ff.colours(); ff.draw(0); });
      ff.loop();
    }).catch(function () {
      canvas.setAttribute("hidden", "");
      var fb = canvas.parentNode.querySelector("[data-flow-fallback]");
      if (fb) fb.hidden = false;
    });
  }

  document.querySelectorAll("canvas[data-flow]").forEach(boot);
})();
