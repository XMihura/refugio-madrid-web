/* REFUGIO paper — embeddable warehouse replay widget.
 *
 * Usage:
 *   <div class="replay-embed"
 *        data-src="paper-assets/replays/human_1008_winner.json"
 *        data-title="The winning submission"
 *        data-note="Team 10 — 1,008 deliveries"></div>
 *   <script src="paper-assets/replay-widget.js" defer></script>
 *
 * The replay JSON is only fetched when the reader presses "Load replay".
 */
(function () {
  "use strict";

  var COLORS = {
    background: "#f1e6c8",
    empty: "#ffffff",
    emptyAlt: "#fbf9f1",
    shelf: "#0e0e0e",
    shelfEdge: "#0e0e0e",
    base: "#2362ab",
    baseEdge: "#0e0e0e",
    grid: "rgba(14, 14, 14, 0.12)",
    robot: "#cc3a2c",
    carrying: "#f1b91e",
    edge: "#0e0e0e",
    target: "#f1b91e",
    targetEdge: "#0e0e0e",
  };
  var PADDING = 6;
  var SPEEDS = [
    { label: "1x", frameMs: 240 },
    { label: "2x", frameMs: 120 },
    { label: "4x", frameMs: 60 },
    { label: "8x", frameMs: 30 },
  ];

  function cellType(layout, x, y) {
    var ch = layout.grid[y] ? layout.grid[y][x] : undefined;
    if (ch === layout.cell_encoding.shelf) return "shelf";
    if (ch === layout.cell_encoding.base) return "base";
    return "empty";
  }

  function drawFrame(canvas, layout, frame, cellSize) {
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var dpr = window.devicePixelRatio || 1;
    var width = layout.width * cellSize + PADDING * 2;
    var height = layout.height * cellSize + PADDING * 2;
    if (canvas.width !== Math.floor(width * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);

    var s = cellSize;
    for (var y = 0; y < layout.height; y++) {
      for (var x = 0; x < layout.width; x++) {
        var type = cellType(layout, x, y);
        var px = PADDING + x * s;
        var py = PADDING + y * s;
        if (type === "shelf") {
          ctx.fillStyle = COLORS.shelf;
          ctx.fillRect(px, py, s, s);
        } else if (type === "base") {
          ctx.fillStyle = COLORS.base;
          ctx.fillRect(px, py, s, s);
        } else if (x === 0 || y === 0 || x === layout.width - 1 || y === layout.height - 1) {
          ctx.fillStyle = COLORS.background;
          ctx.fillRect(px, py, s, s);
        } else {
          ctx.fillStyle = (x + y) % 2 === 0 ? COLORS.emptyAlt : COLORS.empty;
          ctx.fillRect(px, py, s, s);
        }
      }
    }

    // Grid lines
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var gx = 0; gx <= layout.width; gx++) {
      var gpx = PADDING + gx * s + 0.5;
      ctx.moveTo(gpx, PADDING);
      ctx.lineTo(gpx, PADDING + layout.height * s);
    }
    for (var gy = 0; gy <= layout.height; gy++) {
      var gpy = PADDING + gy * s + 0.5;
      ctx.moveTo(PADDING, gpy);
      ctx.lineTo(PADDING + layout.width * s, gpy);
    }
    ctx.stroke();

    if (!frame) return;
    var i;
    // Targets first, then robots on top.
    for (i = 0; i < frame.robots.length; i++) {
      var rt = frame.robots[i];
      if (rt.target && !rt.carrying) {
        var tpx = PADDING + rt.target[0] * s;
        var tpy = PADDING + rt.target[1] * s;
        var oldAlpha = ctx.globalAlpha;
        ctx.fillStyle = COLORS.target;
        ctx.globalAlpha = oldAlpha * 0.75;
        ctx.fillRect(tpx + 1, tpy + 1, s - 2, s - 2);
        ctx.globalAlpha = oldAlpha;
        ctx.strokeStyle = COLORS.targetEdge;
        ctx.strokeRect(tpx + 1.5, tpy + 1.5, s - 3, s - 3);
      }
    }
    for (i = 0; i < frame.robots.length; i++) {
      var r = frame.robots[i];
      var cx = PADDING + r.pos[0] * s + s / 2;
      var cy = PADDING + r.pos[1] * s + s / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, s * 0.34), 0, Math.PI * 2);
      ctx.fillStyle = r.carrying ? COLORS.carrying : COLORS.robot;
      ctx.fill();
      ctx.strokeStyle = COLORS.edge;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function lerpFrame(a, b, t) {
    if (!b || t <= 0) return a;
    if (t >= 1) return b;
    var byId = {};
    for (var i = 0; i < b.robots.length; i++) byId[b.robots[i].id] = b.robots[i];
    var robots = [];
    for (var j = 0; j < a.robots.length; j++) {
      var ra = a.robots[j];
      var rb = byId[ra.id];
      if (!rb) {
        robots.push(ra);
        continue;
      }
      robots.push({
        id: ra.id,
        pos: [
          ra.pos[0] + (rb.pos[0] - ra.pos[0]) * t,
          ra.pos[1] + (rb.pos[1] - ra.pos[1]) * t,
        ],
        carrying: t < 0.5 ? ra.carrying : rb.carrying,
        deliveries: ra.deliveries,
        target: t < 0.5 ? ra.target : rb.target,
      });
    }
    return { tick: a.tick, robots: robots };
  }

  function totalDeliveries(frame) {
    var sum = 0;
    for (var i = 0; i < frame.robots.length; i++) sum += frame.robots[i].deliveries || 0;
    return sum;
  }

  function formatNumber(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function buildPlayer(root, replay) {
    var layout = replay.layout;
    var frames = replay.frames;
    var maxTick = frames.length - 1;

    root.innerHTML = "";
    root.classList.add("rw-loaded");

    var stage = document.createElement("div");
    stage.className = "rw-stage";
    var canvas = document.createElement("canvas");
    canvas.className = "rw-canvas";
    stage.appendChild(canvas);
    root.appendChild(stage);

    var bar = document.createElement("div");
    bar.className = "rw-bar";
    root.appendChild(bar);

    var playBtn = document.createElement("button");
    playBtn.className = "rw-btn rw-play";
    playBtn.type = "button";
    playBtn.textContent = "Play";
    bar.appendChild(playBtn);

    var slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = String(maxTick);
    slider.value = "0";
    slider.step = "1";
    slider.className = "rw-slider";
    bar.appendChild(slider);

    var readout = document.createElement("span");
    readout.className = "rw-readout";
    bar.appendChild(readout);

    var speedWrap = document.createElement("span");
    speedWrap.className = "rw-speeds";
    bar.appendChild(speedWrap);

    var speedIdx = 1; // 2x default, same as the event frontend
    var speedBtns = SPEEDS.map(function (sp, idx) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "rw-btn rw-speed" + (idx === speedIdx ? " rw-active" : "");
      b.textContent = sp.label;
      b.addEventListener("click", function () {
        speedIdx = idx;
        speedBtns.forEach(function (x, k) {
          x.classList.toggle("rw-active", k === idx);
        });
      });
      speedWrap.appendChild(b);
      return b;
    });

    var playing = false;
    var pos = 0; // fractional tick position
    var lastTs = null;
    var rafId = null;

    function cellSize() {
      // Backing store resolution: fixed logical cell size; CSS scales it.
      return 13;
    }

    function render() {
      var i = Math.floor(pos);
      var t = pos - i;
      var frame = lerpFrame(frames[i], frames[Math.min(i + 1, maxTick)], t);
      drawFrame(canvas, layout, frame, cellSize());
      var shown = frames[Math.min(Math.round(pos), maxTick)];
      readout.textContent =
        "tick " + shown.tick + " / " + maxTick + " \u00b7 " +
        formatNumber(totalDeliveries(shown)) + " deliveries";
      slider.value = String(Math.round(pos));
    }

    function stop() {
      playing = false;
      playBtn.textContent = "Play";
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      lastTs = null;
    }

    function step(ts) {
      if (!playing) return;
      if (lastTs === null) lastTs = ts;
      var dt = ts - lastTs;
      lastTs = ts;
      pos += dt / SPEEDS[speedIdx].frameMs;
      if (pos >= maxTick) {
        pos = maxTick;
        render();
        stop();
        return;
      }
      render();
      rafId = requestAnimationFrame(step);
    }

    playBtn.addEventListener("click", function () {
      if (playing) {
        stop();
        return;
      }
      if (pos >= maxTick) pos = 0;
      playing = true;
      playBtn.textContent = "Pause";
      rafId = requestAnimationFrame(step);
    });

    slider.addEventListener("input", function () {
      stop();
      pos = Number(slider.value);
      render();
    });

    render();
    // Autoplay on load — the reader explicitly pressed "Load replay".
    playBtn.click();
  }

  function initEmbed(root) {
    var src = root.getAttribute("data-src");
    var title = root.getAttribute("data-title") || "Warehouse replay";
    var note = root.getAttribute("data-note") || "";

    var poster = document.createElement("div");
    poster.className = "rw-poster";

    var head = document.createElement("div");
    head.className = "rw-poster-title";
    head.textContent = title;
    poster.appendChild(head);

    if (note) {
      var sub = document.createElement("div");
      sub.className = "rw-poster-note";
      sub.textContent = note;
      poster.appendChild(sub);
    }

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rw-btn rw-loadbtn";
    btn.textContent = "\u25b6 Load replay (\u22482 MB)";
    poster.appendChild(btn);

    var hint = document.createElement("div");
    hint.className = "rw-poster-hint";
    hint.textContent =
      "Interactive replay of one official evaluation seed, rendered exactly as on the event platform.";
    poster.appendChild(hint);

    root.appendChild(poster);

    btn.addEventListener("click", function () {
      btn.disabled = true;
      btn.textContent = "Loading\u2026";
      fetch(src)
        .then(function (resp) {
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          return resp.json();
        })
        .then(function (replay) {
          buildPlayer(root, replay);
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = "\u25b6 Load replay (retry)";
          hint.textContent = "Could not load the replay (" + err.message + "). Try again.";
        });
    });
  }

  function init() {
    var embeds = document.querySelectorAll(".replay-embed[data-src]");
    for (var i = 0; i < embeds.length; i++) initEmbed(embeds[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
