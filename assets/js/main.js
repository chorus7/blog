/* 站点交互
   源码来源与许可见 README 的「组件来源」一节：
   - 点击火花：React Bits ClickSpark（MIT + Commons Clause），改写为原生 canvas
   - 数字滚动：transitions.dev 02-number-pop-in（见 footer 内联编排）
   - 标题入场：transitions.dev 18-texts-reveal
   - 图标切换：transitions.dev 09-icon-swap
   - 手风琴：transitions.dev 21-accordion
   - 提示气泡：transitions.dev 17-tooltip
*/
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------- 深浅色 ---------- */
  function initTheme() {
    var root = document.documentElement;
    var toggle = document.querySelector("[data-theme-toggle]");
    if (!toggle) return;
    var swap = toggle.querySelector(".t-icon-swap");

    function sync() {
      var dark = root.dataset.theme === "dark";
      if (swap) swap.dataset.state = dark ? "b" : "a";
      toggle.setAttribute("aria-pressed", dark ? "true" : "false");
      toggle.setAttribute("aria-label", dark ? "切换到浅色" : "切换到深色");
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", dark ? "#1b1618" : "#efe0e0");
    }

    toggle.addEventListener("click", function () {
      var next = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (e) {}
      sync();
    });

    // 用户没手动选过时，跟随系统
    try {
      if (!localStorage.getItem("theme") && window.matchMedia) {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
          root.dataset.theme = e.matches ? "dark" : "light";
          sync();
        });
      }
    } catch (e) {}

    sync();
  }

  /* ---------- 标题入场 ---------- */
  function initReveal() {
    var blocks = document.querySelectorAll(".t-stagger");
    if (!blocks.length) return;
    if (reduceMotion.matches) {
      blocks.forEach(function (b) { b.classList.add("is-shown"); });
      return;
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        blocks.forEach(function (b) { b.classList.add("is-shown"); });
      });
    });
  }

  /* ---------- 手风琴（目录折叠） ---------- */
  function initAccordions() {
    document.querySelectorAll(".t-acc").forEach(function (acc) {
      var head = acc.querySelector(".t-acc-head");
      if (!head) return;
      head.addEventListener("click", function () {
        var open = acc.dataset.open === "true";
        acc.dataset.open = open ? "false" : "true";
        head.setAttribute("aria-expanded", open ? "false" : "true");
      });
    });
  }

  /* ---------- 目录当前项 ---------- */
  function initToc() {
    var rails = document.querySelectorAll(".toc");
    if (!rails.length) return;
    var links = [];
    rails.forEach(function (rail) {
      rail.querySelectorAll('a[href^="#"]').forEach(function (a) {
        links.push(a);
      });
    });
    var targets = [];
    links.forEach(function (a) {
      var id = decodeURIComponent(a.getAttribute("href").slice(1));
      var el = document.getElementById(id);
      if (el && targets.indexOf(el) < 0) targets.push(el);
    });
    if (!targets.length) return;

    var active = null;
    function mark(id) {
      if (active === id) return;
      active = id;
      links.forEach(function (a) {
        var on = decodeURIComponent(a.getAttribute("href").slice(1)) === id;
        a.classList.toggle("is-active", on);
        if (on) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
    }

    var io = new IntersectionObserver(
      function (entries) {
        var visible = entries
          .filter(function (e) { return e.isIntersecting; })
          .sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; });
        if (visible.length) mark(visible[0].target.id);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    );
    targets.forEach(function (t) { io.observe(t); });
    mark(targets[0].id);
  }

  /* ---------- 提示气泡（transitions.dev 17-tooltip） ---------- */
  function initTooltips() {
    document.querySelectorAll(".t-tt-group").forEach(function (group) {
      var tip = group.querySelector(".t-tt");
      if (!tip) return;
      var label = tip.querySelector(".t-tt-text");
      var triggers = Array.prototype.slice.call(group.querySelectorAll(".t-tt-trigger"));
      if (!triggers.length) return;

      function hide() {
        tip.setAttribute("data-show", "false");
        tip.setAttribute("aria-hidden", "true");
      }

      function place(trigger) {
        var showing = tip.getAttribute("data-show") === "true";
        label.textContent = trigger.getAttribute("data-tooltip") || "";
        var cs = getComputedStyle(tip);
        var width = Math.ceil(
          label.scrollWidth + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
        );
        var g = group.getBoundingClientRect();
        var r = trigger.getBoundingClientRect();
        var x = r.left - g.left + r.width / 2 - width / 2;
        if (!showing) {
          tip.style.transition = "none";
          tip.style.width = width + "px";
          tip.style.setProperty("--tt-x", x + "px");
          void tip.offsetWidth;
          tip.style.transition = "";
        } else {
          tip.style.width = width + "px";
          tip.style.setProperty("--tt-x", x + "px");
        }
        tip.setAttribute("data-show", "true");
        tip.setAttribute("aria-hidden", "false");
      }

      triggers.forEach(function (t) {
        t.addEventListener("pointerenter", function (e) {
          if (e.pointerType === "touch") return;
          place(t);
        });
        t.addEventListener("focus", function () { place(t); });
        t.addEventListener("blur", hide);
      });
      group.addEventListener("pointerleave", hide);
    });
  }

  /* ---------- <white> 遮罩展开：升级成可键盘操作的按钮 ---------- */
  function initRevealText() {
    document.querySelectorAll("white").forEach(function (el) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "white-reveal";
      btn.setAttribute("aria-expanded", "false");
      var inner = document.createElement("span");
      inner.className = "white-reveal-text";
      inner.textContent = el.textContent;
      btn.appendChild(inner);
      btn.addEventListener("click", function () {
        var on = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", on ? "false" : "true");
      });
      el.replaceWith(btn);
    });
  }

  /* ---------- 点击火花（React Bits ClickSpark 的原生改写） ---------- */
  function initSpark() {
    var layer = document.querySelector(".spark-layer");
    if (!layer || reduceMotion.matches) return;

    var EASE_OUT = function (t) { return 1 - Math.pow(1 - t, 3); };
    var MAX_BURSTS = 24;
    var clamp = function (v, min, max) { return Math.min(max, Math.max(min, v)); };
    var smoothstep = function (a, b, x) {
      var t = clamp((x - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    };

    var settings = {
      size: 12,
      radius: 26,
      count: 8,
      width: 1.6,
      duration: 460,
      randomness: 0.25,
      gravity: 0,
      spread: 360,
      direction: 0,
      ease: EASE_OUT
    };

    function colors() {
      var cs = getComputedStyle(document.documentElement);
      var accent = cs.getPropertyValue("--accent").trim() || "#9c5252";
      var link = cs.getPropertyValue("--link").trim() || "#55634f";
      return [accent, link, accent];
    }

    var bursts = [];
    var raf = 0;

    function drawSpark(ctx, burst, spark, elapsed) {
      var s = burst.settings;
      var life = s.duration * spark.life;
      var p = elapsed / life;
      if (p >= 1) return false;
      var e = s.ease(clamp(p, 0, 1));
      var seconds = elapsed / 1000;
      var distance = s.radius * spark.reach * e;
      var width = s.width * spark.scale;
      var fade = 1 - smoothstep(0.55, 1, p);
      if (fade <= 0) return true;

      ctx.strokeStyle = spark.color;
      ctx.globalAlpha = fade;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      var length = s.size * spark.scale * Math.pow(1 - p, 1.6);
      var x1 = burst.x + Math.cos(spark.angle) * distance;
      var y1 = burst.y + Math.sin(spark.angle) * distance + 0.5 * s.gravity * 500 * seconds * seconds;
      var x2 = burst.x + Math.cos(spark.angle) * (distance + Math.max(0.01, length));
      var y2 = burst.y + Math.sin(spark.angle) * (distance + Math.max(0.01, length)) + 0.5 * s.gravity * 500 * seconds * seconds;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      return true;
    }

    function frame(now) {
      raf = 0;
      bursts.slice().forEach(function (burst) {
        var elapsed = now - burst.start;
        var ctx = burst.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, burst.canvas.width, burst.canvas.height);
        ctx.setTransform(burst.ratio, 0, 0, burst.ratio, 0, 0);
        var alive = false;
        burst.sparks.forEach(function (spark) {
          if (drawSpark(ctx, burst, spark, elapsed)) alive = true;
        });
        ctx.globalAlpha = 1;
        if (!alive) {
          burst.canvas.remove();
          var i = bursts.indexOf(burst);
          if (i >= 0) bursts.splice(i, 1);
        }
      });
      if (bursts.length) raf = requestAnimationFrame(frame);
    }

    function spawn(clientX, clientY) {
      var s = settings;
      var palette = colors();
      var offset = Math.floor(Math.random() * palette.length);
      var step = (Math.PI * 2) / s.count;
      var heading = ((s.direction - 90) * Math.PI) / 180;
      var sparks = [];
      for (var i = 0; i < s.count; i++) {
        var base = heading + step * i;
        var jitter = (Math.random() - 0.5) * s.randomness;
        sparks.push({
          angle: base + jitter * (step || 1) * 0.9,
          reach: 1 + (Math.random() - 0.5) * 0.7 * s.randomness,
          scale: 1 + (Math.random() - 0.5) * 0.8 * s.randomness,
          life: 1 + (Math.random() - 0.5) * 0.5 * s.randomness,
          color: palette[(i + offset) % palette.length]
        });
      }
      var reach = s.radius * (1 + 0.35 * s.randomness) + s.size + s.width * 2 + 8;
      var box = {
        left: Math.max(clientX - reach, 0),
        top: Math.max(clientY - reach, 0),
        right: Math.min(clientX + reach, window.innerWidth),
        bottom: Math.min(clientY + reach, window.innerHeight)
      };
      if (box.right - box.left < 1 || box.bottom - box.top < 1) return;
      var ratio = Math.min(window.devicePixelRatio || 1, 2);
      var canvas = document.createElement("canvas");
      canvas.width = Math.ceil((box.right - box.left) * ratio);
      canvas.height = Math.ceil((box.bottom - box.top) * ratio);
      canvas.style.left = box.left + "px";
      canvas.style.top = box.top + "px";
      canvas.style.width = box.right - box.left + "px";
      canvas.style.height = box.bottom - box.top + "px";
      canvas.setAttribute("aria-hidden", "true");
      layer.appendChild(canvas);
      var ctx = canvas.getContext("2d");
      if (!ctx) {
        canvas.remove();
        return;
      }
      bursts.push({
        x: clientX - box.left,
        y: clientY - box.top,
        start: performance.now(),
        sparks: sparks,
        settings: s,
        canvas: canvas,
        ctx: ctx,
        ratio: ratio
      });
      while (bursts.length > MAX_BURSTS) {
        var old = bursts.shift();
        if (old) old.canvas.remove();
      }
      if (!raf) raf = requestAnimationFrame(frame);
    }

    var lastPress = { time: -1e9, x: 0, y: 0 };
    document.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      lastPress = { time: performance.now(), x: e.clientX, y: e.clientY };
      spawn(e.clientX, e.clientY);
    });
    document.addEventListener("click", function (e) {
      if ("pointerType" in e && e.pointerType === "mouse") return;
      if (e.detail === 0) {
        var target = e.target instanceof Element ? e.target : document.body;
        var r = target.getBoundingClientRect();
        spawn(r.left + r.width / 2, r.top + r.height / 2);
        return;
      }
      var recent =
        performance.now() - lastPress.time < 700 &&
        Math.hypot(e.clientX - lastPress.x, e.clientY - lastPress.y) < 12;
      if (!recent) spawn(e.clientX, e.clientY);
    });
  }

  function boot() {
    initTheme();
    initReveal();
    initAccordions();
    initToc();
    initTooltips();
    initRevealText();
    initSpark();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
