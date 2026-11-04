/* Part viewer: a small WebGL renderer for CAD meshes exported by tools/rocker_export.py.
   Orthographic camera, so the standard views are true projections and the scale bar is real.
   Two styles: a line drawing (visible edges solid, hidden edges dashed, faces in the paper
   colour) and shaded with edges. Parts can be pulled apart along the assembly axis. */
(function () {
  "use strict";
  var root = document.querySelector("[data-viewer]");
  if (!root) return;
  var canvas = root.querySelector("canvas");
  var gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl) { root.classList.add("viewer--static"); return; }
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- small matrix helpers (column-major, like GL) ---------- */
  function mul(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s;
    }
    return o;
  }
  function ortho(w, h, n, f) {
    var o = new Float32Array(16);
    o[0] = 2 / w; o[5] = 2 / h; o[10] = -2 / (f - n); o[14] = -(f + n) / (f - n); o[15] = 1; return o;
  }
  function viewFrom(yaw, pitch, dist) {
    // camera on a sphere around the origin, Y up
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var eye = [dist * cp * sy, dist * sp, dist * cp * cy];
    var z = norm(eye), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
    var o = new Float32Array(16);
    o[0] = x[0]; o[4] = x[1]; o[8] = x[2];
    o[1] = y[0]; o[5] = y[1]; o[9] = y[2];
    o[2] = z[0]; o[6] = z[1]; o[10] = z[2];
    o[12] = -dot(x, eye); o[13] = -dot(y, eye); o[14] = -dot(z, eye); o[15] = 1;
    return { m: o, eye: eye, x: x, y: y, z: z };
  }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  /* ---------- shaders ---------- */
  var MESH_VS = [
    "attribute vec3 a_p; attribute vec3 a_n;",
    "uniform mat4 u_mvp; uniform vec3 u_lo; uniform vec3 u_hi; uniform vec3 u_c; uniform vec3 u_off;",
    "varying vec3 v_n;",
    "void main(){ vec3 p = u_lo + a_p * (u_hi - u_lo) - u_c + u_off; v_n = a_n; gl_Position = u_mvp * vec4(p, 1.0); }"
  ].join("\n");
  var MESH_FS = [
    "precision mediump float;",
    "uniform vec3 u_col; uniform vec3 u_l1; uniform vec3 u_l2; uniform vec3 u_view; uniform float u_flat; uniform float u_a;",
    "varying vec3 v_n;",
    "void main(){",
    "  vec3 n = normalize(v_n); if (dot(n, u_view) < 0.0) n = -n;",
    "  float d = 0.62 * max(dot(n, u_l1), 0.0) + 0.22 * max(dot(n, u_l2), 0.0) + 0.38;",
    "  float rim = pow(1.0 - max(dot(n, u_view), 0.0), 3.0) * 0.18;",
    "  vec3 c = mix(u_col * d + rim, u_col, u_flat);",
    "  gl_FragColor = vec4(c * u_a, u_a);",
    "}"
  ].join("\n");
  var LINE_VS = [
    "attribute vec3 a_a; attribute vec3 a_b; attribute vec2 a_c;",
    "uniform mat4 u_mvp; uniform vec2 u_res; uniform float u_w; uniform vec3 u_off;",
    "varying float v_d;",
    "void main(){",
    "  vec4 pa = u_mvp * vec4(a_a + u_off, 1.0); vec4 pb = u_mvp * vec4(a_b + u_off, 1.0);",
    "  vec2 sa = pa.xy * u_res * 0.5; vec2 sb = pb.xy * u_res * 0.5;",
    "  vec2 dv = sb - sa; float len = length(dv); vec2 dir = len > 1e-4 ? dv / len : vec2(1.0, 0.0);",
    "  vec2 nr = vec2(-dir.y, dir.x);",
    "  vec4 p = mix(pa, pb, a_c.y);",
    "  vec2 o = nr * a_c.x * u_w * 0.5 + dir * (a_c.y * 2.0 - 1.0) * u_w * 0.5;",
    "  p.xy += o / (u_res * 0.5);",
    "  p.z -= 0.0004;",
    "  v_d = a_c.y * len;",
    "  gl_Position = p;",
    "}"
  ].join("\n");
  var LINE_FS = [
    "precision mediump float;",
    "uniform vec3 u_col; uniform float u_a; uniform float u_dash;",
    "varying float v_d;",
    "void main(){",
    "  if (u_dash > 0.0 && mod(v_d, u_dash * 2.0) > u_dash) discard;",
    "  gl_FragColor = vec4(u_col * u_a, u_a);",
    "}"
  ].join("\n");
  function prog(vs, fs) {
    function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
    var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
    return { p: p, u: u };
  }
  var meshP, lineP;
  try { meshP = prog(MESH_VS, MESH_FS); lineP = prog(LINE_VS, LINE_FS); }
  catch (e) { root.classList.add("viewer--static"); return; }

  /* ---------- state ---------- */
  var VIEWS = {
    iso: { yaw: -0.72, pitch: 0.42 }, front: { yaw: -Math.PI / 2, pitch: 0 },
    top: { yaw: -Math.PI / 2, pitch: Math.PI / 2 - 0.0001 }, side: { yaw: 0, pitch: 0 }
  };
  var S = { yaw: VIEWS.iso.yaw, pitch: VIEWS.iso.pitch, zoom: 1, explode: 0, style: "lines", hover: -1, ready: false };
  var anim = null, spin = !reduce, visible = true, dirty = true;
  var meta = null, parts = [];
  var colours = {};

  function readColours() {
    var cs = getComputedStyle(root);
    function rgb(v) {
      var c = document.createElement("canvas").getContext("2d"); c.fillStyle = v.trim() || "#000";
      var h = c.fillStyle; if (h[0] === "#") return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
      var m = h.match(/[\d.]+/g); return [m[0] / 255, m[1] / 255, m[2] / 255];
    }
    colours = { bg: rgb(cs.getPropertyValue("--viewer-bg")), ink: rgb(cs.getPropertyValue("--viewer-ink")),
      ink2: rgb(cs.getPropertyValue("--viewer-ink-2")), acc: rgb(cs.getPropertyValue("--viewer-acc")),
      metal: rgb(cs.getPropertyValue("--viewer-metal")), metal2: rgb(cs.getPropertyValue("--viewer-metal-2")) };
    dirty = true;
  }

  /* ---------- load ---------- */
  var src = root.getAttribute("data-src");
  fetch(src + ".json").then(function (r) { return r.json(); })
    .then(function (m) {
      var s = atob(m.mesh_b64), bytes = new Uint8Array(s.length);   // the mesh travels as base64
      for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
      delete m.mesh_b64;
      build(m, bytes.buffer);
    })
    .catch(function () { root.classList.add("viewer--static"); });

  function build(m, buf) {
    meta = m;
    var lo = m.box_min, hi = m.box_max, c = m.centre;
    m.parts.forEach(function (pt, i) {
      var nv = pt.vertices, nt = pt.triangles;
      var pos = new Uint16Array(buf, pt.pos, nv * 3), nrm = new Int8Array(buf, pt.nrm, nv * 3);
      var idx = new Uint16Array(buf, pt.idx, nt * 3);
      var P = { info: pt, n: nt * 3, dir: Math.sign(pt.centre[0]) || 0 };
      P.pos = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, P.pos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
      P.nrm = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, P.nrm); gl.bufferData(gl.ARRAY_BUFFER, nrm, gl.STATIC_DRAW);
      P.idx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, P.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      P.sample = [];
      for (var k = 0; k < nv; k += 7) for (var j = 0; j < 3; j++) P.sample.push(lo[j] + pos[k * 3 + j] / 65535 * (hi[j] - lo[j]) - c[j]);
      P.sharp = lines(new Uint16Array(buf, pt.sharp_off, pt.sharp * 6), lo, hi, c);
      P.tan = lines(new Uint16Array(buf, pt.tangent_off, pt.tangent * 6), lo, hi, c);
      parts.push(P);
    });
    S.ready = true; root.classList.add("viewer--ready");
    fillTable(); readColours(); resize(); S.zoom = fit(S.yaw, S.pitch); loop();
  }
  function lines(q, lo, hi, c) {
    var nseg = q.length / 6;
    if (!nseg) return null;
    var v = new Float32Array(nseg * 4 * 8), ix = new Uint16Array(nseg * 6);
    function d(k, j) { return lo[j] + q[k * 3 + j] / 65535 * (hi[j] - lo[j]) - c[j]; }
    for (var s = 0; s < nseg; s++) {
      var a = [d(2 * s, 0), d(2 * s, 1), d(2 * s, 2)], b = [d(2 * s + 1, 0), d(2 * s + 1, 1), d(2 * s + 1, 2)];
      var C = [[-1, 0], [1, 0], [-1, 1], [1, 1]];
      for (var k = 0; k < 4; k++) {
        var o = (s * 4 + k) * 8;
        v[o] = a[0]; v[o + 1] = a[1]; v[o + 2] = a[2]; v[o + 3] = b[0]; v[o + 4] = b[1]; v[o + 5] = b[2];
        v[o + 6] = C[k][0]; v[o + 7] = C[k][1];
      }
      var i0 = s * 4; ix.set([i0, i0 + 1, i0 + 2, i0 + 2, i0 + 1, i0 + 3], s * 6);
    }
    var L = { n: nseg * 6 };
    L.v = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, L.v); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    L.i = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.i); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ix, gl.STATIC_DRAW);
    return L;
  }

  /* ---------- draw ---------- */
  var W = 1, H = 1, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    dirty = true;
  }
  function camera() {
    var span = meta.span * 1.18 / S.zoom, aspect = W / H;
    var w = aspect >= 1 ? span * aspect : span, h = aspect >= 1 ? span : span / aspect;
    var v = viewFrom(S.yaw, S.pitch, meta.span * 2);
    return { mvp: mul(ortho(w, h, 0.1, meta.span * 4), v.m), v: v, mmPerPx: h / H };
  }
  var hull = null;
  function fit(yaw, pitch) {
    if (!hull) {
      hull = [];
      parts.forEach(function (P) { var a = P.sample; for (var i = 0; i < a.length; i += 3) hull.push([a[i], a[i + 1], a[i + 2], P.dir]); });
    }
    var v = viewFrom(yaw, pitch, 1), x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    hull.forEach(function (p) {
      var q = [p[0] + p[3] * S.explode * 0.55 * meta.span * 0.3, p[1], p[2]];
      var sx = dot(q, v.x), sy = dot(q, v.y);
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    });
    var aspect = W / H, span = meta.span * 1.18;
    var needH = Math.max(y1 - y0, (x1 - x0) / aspect) / 0.74;
    var h = aspect >= 1 ? span : span / aspect;
    return clamp(h / needH, 0.6, 4);
  }
  function offset(P) { return [P.dir * S.explode * 0.55 * meta.span * 0.3, 0, 0]; }
  function drawMesh(cam, P, col, flat, a) {
    gl.useProgram(meshP.p); var u = meshP.u;
    gl.uniformMatrix4fv(u.u_mvp, false, cam.mvp);
    gl.uniform3fv(u.u_lo, meta.box_min); gl.uniform3fv(u.u_hi, meta.box_max); gl.uniform3fv(u.u_c, meta.centre);
    gl.uniform3fv(u.u_off, offset(P)); gl.uniform3fv(u.u_col, col); gl.uniform1f(u.u_flat, flat); gl.uniform1f(u.u_a, a);
    var l1 = norm([cam.v.x[0] * -0.45 + cam.v.y[0] * 0.65 + cam.v.z[0] * 0.6, cam.v.x[1] * -0.45 + cam.v.y[1] * 0.65 + cam.v.z[1] * 0.6, cam.v.x[2] * -0.45 + cam.v.y[2] * 0.65 + cam.v.z[2] * 0.6]);
    gl.uniform3fv(u.u_l1, l1); gl.uniform3fv(u.u_l2, norm([-l1[0], 0.3, -l1[2]])); gl.uniform3fv(u.u_view, cam.v.z);
    gl.bindBuffer(gl.ARRAY_BUFFER, P.pos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, true, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, P.nrm); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.BYTE, true, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, P.idx); gl.drawElements(gl.TRIANGLES, P.n, gl.UNSIGNED_SHORT, 0);
    gl.disableVertexAttribArray(1);
  }
  function drawLines(cam, P, L, col, w, a, dash) {
    if (!L) return;
    gl.useProgram(lineP.p); var u = lineP.u;
    gl.uniformMatrix4fv(u.u_mvp, false, cam.mvp); gl.uniform2f(u.u_res, W, H);
    gl.uniform1f(u.u_w, w * dpr); gl.uniform3fv(u.u_off, offset(P)); gl.uniform3fv(u.u_col, col);
    gl.uniform1f(u.u_a, a); gl.uniform1f(u.u_dash, dash * dpr);
    gl.bindBuffer(gl.ARRAY_BUFFER, L.v);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.i); gl.drawElements(gl.TRIANGLES, L.n, gl.UNSIGNED_SHORT, 0);
    gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
  }
  gl.bindAttribLocation(meshP.p, 0, "a_p"); gl.bindAttribLocation(meshP.p, 1, "a_n"); gl.linkProgram(meshP.p);
  gl.bindAttribLocation(lineP.p, 0, "a_a"); gl.bindAttribLocation(lineP.p, 1, "a_b"); gl.bindAttribLocation(lineP.p, 2, "a_c"); gl.linkProgram(lineP.p);
  meshP = relink(meshP); lineP = relink(lineP);
  function relink(o) { var u = {}, n = gl.getProgramParameter(o.p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var a = gl.getActiveUniform(o.p, i); u[a.name] = gl.getUniformLocation(o.p, a.name); } return { p: o.p, u: u }; }

  function render() {
    var cam = camera();
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    var lines = S.style === "lines";
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 2);
    parts.forEach(function (P, i) {
      var hl = i === S.hover;
      var col = lines ? (hl ? mix(colours.bg, colours.acc, 0.14) : colours.bg) : (hl ? mix(colours.metal, colours.acc, 0.45) : (P.dir === 0 ? colours.metal2 : colours.metal));
      drawMesh(cam, P, col, lines ? 1 : 0, 1);
    });
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthMask(false);
    parts.forEach(function (P, i) {
      var hl = i === S.hover, ink = hl ? colours.acc : colours.ink;
      if (lines) {
        gl.depthFunc(gl.GREATER);                       // hidden edges, dashed
        drawLines(cam, P, P.sharp, colours.ink2, 0.85, 0.38, 3);
        gl.depthFunc(gl.LEQUAL);
        drawLines(cam, P, P.tan, colours.ink2, 0.9, 0.9, 0);
        drawLines(cam, P, P.sharp, ink, 1.35, 1, 0);
      } else {
        drawLines(cam, P, P.sharp, hl ? colours.acc : colours.ink, 1.0, 0.85, 0);
      }
    });
    gl.depthMask(true);
    updateHud(cam);
  }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  /* ---------- HUD: angles and a true scale bar ---------- */
  var hudAng = root.querySelector("[data-viewer-angles]"), bar = root.querySelector("[data-viewer-bar]"), barTxt = root.querySelector("[data-viewer-bar-text]");
  function updateHud(cam) {
    if (hudAng) {
      var az = Math.round(((S.yaw * 180 / Math.PI) % 360 + 360) % 360), el = Math.round(S.pitch * 180 / Math.PI);
      hudAng.textContent = "AZ " + az + "°  EL " + el + "°";
    }
    if (bar) {
      var mmPerCss = cam.mmPerPx * dpr, steps = [10, 20, 25, 50, 100, 200], len = 50;
      for (var i = 0; i < steps.length; i++) { if (steps[i] / mmPerCss >= 70) { len = steps[i]; break; } len = steps[i]; }
      bar.style.width = (len / mmPerCss).toFixed(1) + "px";
      barTxt.textContent = len + " mm";
    }
  }

  /* ---------- loop ---------- */
  var last = 0;
  function loop(t) {
    t = t || 0;
    var dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    if (anim) {
      anim.t = Math.min(1, anim.t + dt / anim.dur); var e = 1 - Math.pow(1 - anim.t, 3);
      for (var k in anim.to) S[k] = anim.from[k] + (anim.to[k] - anim.from[k]) * e;
      if (anim.t >= 1) anim = null; dirty = true;
    } else if (spin && visible && S.ready) { S.yaw += dt * 0.25; dirty = true; }
    if (dirty && S.ready && visible) { render(); dirty = false; }
    requestAnimationFrame(loop);
  }
  function go(to, dur) {
    var from = {}; for (var k in to) from[k] = S[k];
    if (to.yaw !== undefined) { // shortest way round
      var d = ((to.yaw - S.yaw) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; to.yaw = S.yaw + d;
    }
    if (reduce) { for (var j in to) S[j] = to[j]; dirty = true; return; }
    anim = { from: from, to: to, t: 0, dur: dur || 0.7 };
  }
  function stopSpin() { spin = false; }

  /* ---------- input ---------- */
  var drag = null, pinch = null, pointers = {};
  canvas.addEventListener("pointerdown", function (e) {
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pointers);
    if (ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: S.zoom }; drag = null;
    } else { drag = { x: e.clientX, y: e.clientY, yaw: S.yaw, pitch: S.pitch, type: e.pointerType }; }
    canvas.setPointerCapture(e.pointerId); stopSpin(); anim = null;
  });
  canvas.addEventListener("pointermove", function (e) {
    if (pointers[e.pointerId]) pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (pinch) {
      var ids = Object.keys(pointers); if (ids.length < 2) return;
      var a = pointers[ids[0]], b = pointers[ids[1]];
      S.zoom = clamp(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, 0.6, 4); dirty = true; return;
    }
    if (drag) {
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      S.yaw = drag.yaw - dx * 0.008;
      if (drag.type !== "touch") S.pitch = clamp(drag.pitch + dy * 0.008, -Math.PI / 2 + 0.0001, Math.PI / 2 - 0.0001);
      dirty = true; return;
    }
    hoverAt(e);
  });
  function end(e) { delete pointers[e.pointerId]; if (Object.keys(pointers).length < 2) pinch = null; drag = null; }
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", function () { setHover(-1); });
  canvas.addEventListener("wheel", function (e) {
    if (!e.ctrlKey && !e.metaKey) return;               // plain wheel scrolls the page
    e.preventDefault(); stopSpin(); S.zoom = clamp(S.zoom * Math.exp(-e.deltaY * 0.004), 0.6, 4); dirty = true;
  }, { passive: false });
  canvas.addEventListener("dblclick", function () { go({ yaw: VIEWS.iso.yaw, pitch: VIEWS.iso.pitch, zoom: fit(VIEWS.iso.yaw, VIEWS.iso.pitch) }); });
  canvas.addEventListener("keydown", function (e) {
    var step = 0.12, used = true;
    if (e.key === "ArrowLeft") S.yaw += step; else if (e.key === "ArrowRight") S.yaw -= step;
    else if (e.key === "ArrowUp") S.pitch = clamp(S.pitch + step, -1.57, 1.57); else if (e.key === "ArrowDown") S.pitch = clamp(S.pitch - step, -1.57, 1.57);
    else if (e.key === "+" || e.key === "=") S.zoom = clamp(S.zoom * 1.15, 0.6, 4); else if (e.key === "-") S.zoom = clamp(S.zoom / 1.15, 0.6, 4);
    else used = false;
    if (used) { e.preventDefault(); stopSpin(); dirty = true; }
  });
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* hover picking: project each part's box and test the pointer against the drawn pixels
     would need a pick buffer; a cheap ray test against each part's triangles is enough here */
  var pickCache = null;
  function hoverAt(e) {
    if (!S.ready || e.pointerType === "touch") return;
    var r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 2 - 1, y = -((e.clientY - r.top) / r.height * 2 - 1);
    setHover(pick(x, y));
  }
  function pick(x, y) {
    var cam = camera();
    if (!pickCache) pickCache = parts.map(function (P) { return null; });
    // render ids into a 1x1 scissored framebuffer
    if (!pick.fb) {
      pick.fb = gl.createFramebuffer(); pick.tex = gl.createTexture(); pick.rb = gl.createRenderbuffer();
    }
    var fbw = W, fbh = H;
    gl.bindTexture(gl.TEXTURE_2D, pick.tex);
    if (pick.w !== fbw || pick.h !== fbh) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fbw, fbh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, pick.rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, fbw, fbh);
      pick.w = fbw; pick.h = fbh;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, pick.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pick.tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, pick.rb);
    var px = Math.floor((x + 1) / 2 * fbw), py = Math.floor((y + 1) / 2 * fbh);
    gl.viewport(0, 0, fbw, fbh); gl.enable(gl.SCISSOR_TEST); gl.scissor(px, py, 1, 1);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    parts.forEach(function (P, i) { drawMesh(cam, P, [(i + 1) / 255, 0, 0], 1, 1); });
    var out = new Uint8Array(4); gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.disable(gl.SCISSOR_TEST); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out[3] > 0 ? out[0] - 1 : -1;
  }
  var rows = [];
  function setHover(i) {
    if (i === S.hover) return; S.hover = i; dirty = true;
    rows.forEach(function (r, k) { r.classList.toggle("is-hot", k === i); });
  }

  /* ---------- controls ---------- */
  root.querySelectorAll("[data-view]").forEach(function (b) {
    b.addEventListener("click", function () {
      var v = VIEWS[b.getAttribute("data-view")]; stopSpin(); go({ yaw: v.yaw, pitch: v.pitch, zoom: fit(v.yaw, v.pitch) });
      root.querySelectorAll("[data-view]").forEach(function (o) { o.setAttribute("aria-pressed", o === b ? "true" : "false"); });
    });
  });
  root.querySelectorAll("[data-style]").forEach(function (b) {
    b.addEventListener("click", function () {
      S.style = b.getAttribute("data-style"); dirty = true;
      root.querySelectorAll("[data-style]").forEach(function (o) { o.setAttribute("aria-pressed", o === b ? "true" : "false"); });
    });
  });
  var ex = root.querySelector("[data-explode]");
  if (ex) ex.addEventListener("input", function () { S.explode = ex.value / 100; stopSpin(); dirty = true; });
  var spinBtn = root.querySelector("[data-spin]");
  if (spinBtn) {
    if (reduce) spinBtn.hidden = true;
    spinBtn.addEventListener("click", function () { spin = !spin; spinBtn.setAttribute("aria-pressed", spin ? "true" : "false"); });
  }

  function fillTable() {
    var tb = root.querySelector("[data-viewer-parts]");
    if (!tb) return;
    tb.innerHTML = "";
    meta.parts.forEach(function (pt, i) {
      var tr = document.createElement("tr");
      tr.innerHTML = "<td class=\"num\">" + (i + 1) + "</td><td>" + pt.label.toUpperCase() + "</td><td class=\"num\">" +
        pt.size_mm.map(function (v) { return Math.round(v); }).join(" × ") + "</td><td class=\"num\">" + pt.volume_cm3.toFixed(0) + "</td>";
      tr.addEventListener("mouseenter", function () { setHover(i); });
      tr.addEventListener("mouseleave", function () { setHover(-1); });
      tb.appendChild(tr); rows.push(tr);
    });
  }

  /* ---------- page wiring ---------- */
  window.addEventListener("resize", resize);
  document.addEventListener("themechange", readColours);
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readColours);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) dirty = true; }, { rootMargin: "100px" }).observe(canvas);
  }
  canvas.addEventListener("webglcontextlost", function (e) { e.preventDefault(); root.classList.add("viewer--static"); });
})();
