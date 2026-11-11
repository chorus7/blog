/* 弹幕留言
   无登录，匿名发；后端在 danmaku-api/（Azure Functions + 表存储）。
   飘屏用 CSS 动画 + requestAnimationFrame 控制并发，
   减少动态效果时直接给静态列表，不跑动画。
*/
(function () {
  "use strict";

  var API = window.DANMAKU_API || "";
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  var root = document.querySelector("[data-danmaku]");
  if (!root || !API) return;

  var stage = root.querySelector("[data-danmaku-stage]");
  var listEl = root.querySelector("[data-danmaku-list]");
  var form = root.querySelector("[data-danmaku-form]");
  var input = root.querySelector("[data-danmaku-input]");
  var submit = root.querySelector("[data-danmaku-submit]");
  var statusEl = root.querySelector("[data-danmaku-status]");
  var countEl = root.querySelector("[data-danmaku-count]");

  var COLORS = ["", "pink", "green", "yellow", "blue", "purple", "orange"];
  var color = "";
  var items = [];
  var laneCount = 0;
  var lastLane = 0;

  function setStatus(msg, kind) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.dataset.kind = kind || "";
  }

  /* ---------- 列表 ---------- */
  function renderList() {
    if (!listEl) return;
    if (!items.length) {
      listEl.innerHTML = '<li class="danmaku-empty">还没有人说话。</li>';
      return;
    }
    var frag = document.createDocumentFragment();
    items.forEach(function (it) {
      var li = document.createElement("li");
      li.className = "danmaku-item";
      if (it.color) li.dataset.color = it.color;

      var txt = document.createElement("span");
      txt.className = "danmaku-text";
      txt.textContent = it.text; // 一律 textContent，绝不拼 HTML

      var meta = document.createElement("span");
      meta.className = "danmaku-meta";
      meta.textContent = (it.name ? it.name + " · " : "") + timeAgo(it.ts);

      li.appendChild(txt);
      li.appendChild(meta);
      frag.appendChild(li);
    });
    listEl.innerHTML = "";
    listEl.appendChild(frag);
  }

  function timeAgo(ts) {
    if (!ts) return "";
    var d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return "刚刚";
    if (d < 3600) return Math.floor(d / 60) + " 分钟前";
    if (d < 86400) return Math.floor(d / 3600) + " 小时前";
    if (d < 2592000) return Math.floor(d / 86400) + " 天前";
    var dt = new Date(ts);
    return (dt.getMonth() + 1) + "月" + dt.getDate() + "日";
  }

  /* ---------- 飘屏 ---------- */
  function lanes() {
    if (!stage) return 1;
    // 每条轨道 2.6em，留一点余量避免贴边
    return Math.max(1, Math.floor(stage.clientHeight / 34));
  }

  function shoot(it) {
    if (!stage) return;
    var el = document.createElement("span");
    el.className = "danmaku-shot";
    if (it.color) el.dataset.color = it.color;
    el.textContent = it.text;
    el.title = it.name ? it.name + "：" + it.text : it.text;

    if (reduceMotion.matches) {
      // 不跑动画：静态平铺，保留最近 8 条，新的挤掉最旧的。
      // 不能定时移除 —— 那会让偏好减少动效的人打开页面 4 秒后就什么都看不到。
      stage.appendChild(el);
      while (stage.children.length > 8) stage.removeChild(stage.firstChild);
      return;
    }

    laneCount = lanes();
    lastLane = (lastLane + 1) % laneCount;
    el.style.top = lastLane * 34 + "px";

    stage.appendChild(el);

    // 距离决定时长，保证速度一致（约 90px/s）
    // 起点/终点都用像素：translateX 的百分比基准是元素自身宽度，不是容器
    var w = el.offsetWidth;
    var from = stage.clientWidth;
    var to = -(w + 40);
    var dist = from - to;
    var dur = Math.max(6000, Math.round((dist / 90) * 1000));
    el.style.setProperty("--dur", dur + "ms");
    el.style.setProperty("--from", from + "px");
    el.style.setProperty("--to", to + "px");

    el.addEventListener("animationend", function () { el.remove(); }, { once: true });
  }

  function replay() {
    if (!items.length) return;
    var i = 0;
    // 先放最近 12 条，间隔 1.2 秒，避免一拥而上
    var recent = items.slice(0, 12).reverse();
    function next() {
      if (i >= recent.length) return;
      shoot(recent[i++]);
      if (!reduceMotion.matches) setTimeout(next, 1200);
      else next(); // 静态模式不需要排队等动画，一次铺满
    }
    next();
  }

  /* ---------- 拉取 ---------- */
  function load() {
    fetch(API + "/danmaku", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) throw new Error(d && d.message);
        items = d.items || [];
        if (countEl) countEl.textContent = items.length ? items.length + " 条" : "";
        renderList();
        replay();
      })
      .catch(function () {
        setStatus("留言加载失败，稍后再试", "err");
        if (listEl) listEl.innerHTML = '<li class="danmaku-empty">加载失败。</li>';
      });
  }

  /* ---------- 发送 ---------- */
  function send(e) {
    e.preventDefault();
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;

    submit.disabled = true;
    setStatus("发送中…", "");

    fetch(API + "/danmaku", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ text: text, color: color }),
    })
      .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
      .then(function (res) {
        if (!res.d || !res.d.ok) {
          setStatus((res.d && res.d.message) || "没发出去", "err");
          return;
        }
        input.value = "";
        setStatus("已发出", "ok");
        items.unshift(res.d.item);
        if (countEl) countEl.textContent = items.length + " 条";
        renderList();
        shoot(res.d.item);
        setTimeout(function () { setStatus("", ""); }, 2500);
      })
      .catch(function () {
        setStatus("网络不通，稍后再试", "err");
      })
      .finally(function () {
        submit.disabled = false;
      });
  }

  /* ---------- 颜色选择 ---------- */
  function initColors() {
    var btns = root.querySelectorAll("[data-danmaku-color]");
    btns.forEach(function (b) {
      b.addEventListener("click", function () {
        color = b.dataset.danmakuColor || "";
        btns.forEach(function (x) {
          x.setAttribute("aria-pressed", x === b ? "true" : "false");
        });
      });
    });
  }

  /* ---------- 键盘 ---------- */
  function initKeys() {
    if (!input) return;
    input.addEventListener("keydown", function (e) {
      // Ctrl/Cmd + Enter 发送，普通 Enter 换行
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        form.requestSubmit ? form.requestSubmit() : send(e);
      }
    });
  }

  if (form) form.addEventListener("submit", send);
  initColors();
  initKeys();
  load();

  // 页面回到前台时刷新一次，长时间挂着也能看到新留言
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) load();
  });

  // 飘屏容器尺寸变化时重算轨道
  if (window.ResizeObserver && stage) {
    new ResizeObserver(function () { laneCount = lanes(); }).observe(stage);
  }
})();
