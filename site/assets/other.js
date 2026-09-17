(() => {
  const $ = (s) => document.querySelector(s);
  const PAGE_SIZE = 20;
  const SPIN_MS = 280;
  const FAV_KEY = "poke:fav";
  const READ_KEY = "poke:read";
  const NG_KEY = "poke:ng";

  const store = {
    get(key, fallback) {
      try {
        const v = JSON.parse(localStorage.getItem(key) || "null");
        return v === null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* プライベートモードなどでは保存しない */
      }
    },
  };

  let read = store.get(READ_KEY, []);
  let ngWords = store.get(NG_KEY, []);

  function matchesNg(it) {
    if (!ngWords.length) return false;
    const text = `${it.title} ${it.summary || ""}`.toLowerCase();
    return ngWords.some((w) => text.includes(w.toLowerCase()));
  }
  function markRead(id) {
    if (read.includes(id)) return;
    read = [id, ...read].slice(0, 400);
    store.set(READ_KEY, read);
  }

  // ---------- サムネイル ----------
  const CAT_EMOJI = {
    new: "✨", update: "🛠️", event: "🎉", tcgcat: "🃏", goodscat: "🎁",
    media: "🎬", guide: "📖", community: "🏆", biz: "📈", other: "📰",
  };
  function hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }
  function applyPlaceholder(box, seed, glyph) {
    const hue = hashHue(seed);
    box.classList.add("thumb-ph");
    box.style.background = `linear-gradient(135deg, hsl(${hue} 68% 62%), hsl(${(hue + 46) % 360} 68% 46%))`;
    box.textContent = glyph;
  }
  function thumbNode(url, seed, glyph, className) {
    const box = document.createElement("div");
    box.className = className;
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => {
        img.remove();
        applyPlaceholder(box, seed, glyph);
      });
      box.appendChild(img);
    } else {
      applyPlaceholder(box, seed, glyph);
    }
    return box;
  }
  function spinnerNode() {
    const sp = document.createElement("span");
    sp.className = "spinner";
    sp.setAttribute("role", "status");
    sp.setAttribute("aria-label", "読み込み中");
    return sp;
  }
  function swapWithSpinner(box, render, { min = 76, max = 260 } = {}) {
    const h = Math.min(max, Math.max(min, box.offsetHeight || 0));
    box.style.minHeight = `${h}px`;
    box.classList.add("is-loading");
    box.innerHTML = "";
    box.appendChild(spinnerNode());
    setTimeout(() => {
      render();
      box.classList.remove("is-loading");
      box.style.minHeight = "";
    }, SPIN_MS);
  }
  function hhmm(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  // ---------- ニュースガチャ ----------
  let newsData = null;
  let gachaId = "";
  function renderGacha() {
    const box = $("#gachaBody");
    if (!newsData) return;
    const pool = newsData.items.filter((it) => !it.isPR && !matchesNg(it));
    box.innerHTML = "";
    if (!pool.length) return;
    const unread = pool.filter((it) => !read.includes(it.id) && it.id !== gachaId);
    const from = unread.length ? unread : pool.filter((it) => it.id !== gachaId);
    const it = (from.length ? from : pool)[Math.floor(Math.random() * (from.length || pool.length))];
    gachaId = it.id;

    const a = document.createElement("a");
    a.className = "gacha-item";
    a.href = it.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.addEventListener("click", () => markRead(it.id));
    const thumb = thumbNode(it.image, it.title, CAT_EMOJI[it.categories[0]] || CAT_EMOJI.other, "gacha-thumb");
    const info = document.createElement("div");
    info.className = "gacha-info";
    const meta = document.createElement("div");
    meta.className = "gacha-meta";
    meta.textContent = `${it.source} ・ ${hhmm(it.publishedAt)}`;
    const t = document.createElement("div");
    t.className = "gacha-title";
    t.textContent = it.title;
    info.append(meta, t);
    a.append(thumb, info);
    box.appendChild(a);
  }

  // ---------- きょうの1匹（全国図鑑） ----------
  let dex = null;
  let dexId = 0;
  async function loadDex() {
    if (dex) return dex;
    try {
      const r = await fetch("data/dex.json");
      dex = (await r.json()).entries || [];
    } catch {
      dex = [];
    }
    return dex;
  }
  function renderDex() {
    const box = $("#dexBody");
    box.innerHTML = "";
    if (!dex || !dex.length) {
      box.innerHTML = `<p class="mod-desc">図鑑データを読み込めませんでした。</p>`;
      return;
    }
    const rareOnly = $("#dexRare").checked;
    const pool = rareOnly ? dex.filter((e) => e.isLegendary || e.isMythical) : dex;
    const from = pool.filter((e) => e.id !== dexId);
    const e = from[Math.floor(Math.random() * from.length)] || pool[0];
    if (!e) return;
    dexId = e.id;

    const card = document.createElement("div");
    card.className = "dex-card";

    const img = document.createElement("img");
    img.className = "dex-img";
    img.src = e.image;
    img.alt = e.name;
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";

    const no = document.createElement("div");
    no.className = "dex-no";
    no.textContent = `No.${String(e.id).padStart(4, "0")}`;

    const name = document.createElement("div");
    name.className = "dex-name";
    name.textContent = e.name;
    if (e.isLegendary || e.isMythical) {
      const tag = document.createElement("span");
      tag.className = "dex-rare";
      tag.textContent = e.isMythical ? "幻" : "伝説";
      name.appendChild(tag);
    }

    const types = document.createElement("div");
    types.className = "dex-types";
    for (const t of e.types || []) {
      const s = document.createElement("span");
      s.className = `dex-type type-${t}`;
      s.textContent = t;
      types.appendChild(s);
    }

    const size = document.createElement("div");
    size.className = "dex-size";
    size.textContent = `${e.genus ? `${e.genus} ・ ` : ""}高さ ${e.height}m ・ 重さ ${e.weight}kg`;

    const flavor = document.createElement("p");
    flavor.className = "dex-flavor";
    flavor.textContent = e.flavor || "";

    card.append(img, no, name, types, size, flavor);
    box.appendChild(card);
  }

  // ---------- その他のニュース一覧（ページネーション） ----------
  let items = [];
  let page = 1;

  function totalPages() {
    return Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  }

  function renderList() {
    const box = $("#otherBody");
    box.innerHTML = "";
    const start = (page - 1) * PAGE_SIZE;
    const pageItems = items.slice(start, start + PAGE_SIZE);
    if (!pageItems.length) {
      box.innerHTML = `<p class="empty">記事がありません。</p>`;
      return;
    }
    const ul = document.createElement("ul");
    ul.className = "other-page-list";
    for (const it of pageItems) {
      const li = document.createElement("li");
      const meta = document.createElement("div");
      meta.className = "other-meta";
      meta.textContent = `${it.source} ・ ${hhmm(it.publishedAt)}`;
      const a = document.createElement("a");
      a.href = it.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = it.title;
      li.append(meta, a);
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }

  function pageButton(label, targetPage, { disabled = false, active = false } = {}) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (active) b.className = "active";
    if (disabled) b.disabled = true;
    b.addEventListener("click", () => goTo(targetPage));
    return b;
  }

  function dots() {
    const s = document.createElement("span");
    s.className = "pg-dots";
    s.textContent = "…";
    return s;
  }

  function renderPagination() {
    const nav = $("#pagination");
    nav.innerHTML = "";
    const tp = totalPages();
    if (tp <= 1) return;

    nav.appendChild(pageButton("‹ 前へ", page - 1, { disabled: page <= 1 }));

    const windowSize = 5;
    let startP = Math.max(1, page - 2);
    let endP = Math.min(tp, startP + windowSize - 1);
    startP = Math.max(1, endP - windowSize + 1);

    if (startP > 1) {
      nav.appendChild(pageButton("1", 1));
      if (startP > 2) nav.appendChild(dots());
    }
    for (let p = startP; p <= endP; p++) {
      nav.appendChild(pageButton(String(p), p, { active: p === page }));
    }
    if (endP < tp) {
      if (endP < tp - 1) nav.appendChild(dots());
      nav.appendChild(pageButton(String(tp), tp));
    }

    nav.appendChild(pageButton("次へ ›", page + 1, { disabled: page >= tp }));
  }

  // ページを切り替えるとき、パッと入れ替えず一瞬クルクルを挟む
  function goTo(p) {
    const tp = totalPages();
    p = Math.max(1, Math.min(tp, p));
    if (p === page) return;
    const box = $("#otherBody");
    const h = box.offsetHeight || 200;
    box.style.minHeight = `${h}px`;
    box.classList.add("is-loading");
    box.innerHTML = "";
    box.appendChild(spinnerNode());
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => {
      page = p;
      renderList();
      renderPagination();
      box.classList.remove("is-loading");
      box.style.minHeight = "";
    }, SPIN_MS);
  }

  async function boot() {
    $("#year").textContent = new Date().getFullYear();

    try {
      const r = await fetch(`data/other.json?t=${Math.floor(Date.now() / 300000)}`);
      const data = await r.json();
      items = data.items || [];
    } catch {
      $("#otherBody").innerHTML = "";
      $("#empty").hidden = false;
    }
    renderList();
    renderPagination();

    try {
      const r = await fetch(`data/news.json?t=${Math.floor(Date.now() / 300000)}`);
      newsData = await r.json();
    } catch {
      $("#gachaBody").innerHTML = `<p class="mod-desc">読み込めませんでした。</p>`;
      return;
    }
    renderGacha();
    loadDex().then(renderDex);
  }

  $("#gachaAgain").addEventListener("click", () => swapWithSpinner($("#gachaBody"), renderGacha));
  $("#dexAgain").addEventListener("click", () => swapWithSpinner($("#dexBody"), renderDex, { min: 210, max: 360 }));
  $("#dexRare").addEventListener("change", () => swapWithSpinner($("#dexBody"), renderDex, { min: 210, max: 360 }));

  boot();
})();
