(() => {
  const $ = (s) => document.querySelector(s);
  const PAGE = 40;
  const TOPICS_FIRST = 4;
  const SPIN_MS = 320;
  const FAV_KEY = "poke:fav";
  const READ_KEY = "poke:read";
  const STATE_KEY = "poke:state";

  let data = null;
  let shown = PAGE;
  let topicsShown = TOPICS_FIRST;
  let shuffleSeed = Math.random();

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

  const NG_KEY = "poke:ng";
  let fav = store.get(FAV_KEY, []);
  let read = store.get(READ_KEY, []);
  let ngWords = store.get(NG_KEY, []);
  const state = Object.assign({ cat: "all", q: "", hidePR: false, sort: "new" }, store.get(STATE_KEY, {}));

  // ---------- 小物 ----------
  function hhmm(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function dayKey(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function dayLabel(key) {
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - date) / 86400000);
    const wd = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
    if (diff === 0) return `今日 ${m}/${d}（${wd}）`;
    if (diff === 1) return `昨日 ${m}/${d}（${wd}）`;
    return `${m}/${d}（${wd}）`;
  }
  function labelOfCat(id) {
    return data.categories.find((c) => c.id === id)?.label || "";
  }
  function labelOfSeries(id) {
    return data.series.find((s) => s.id === id)?.label || "";
  }
  // ---------- サムネイル ----------
  // 画像が取れなかった記事には、見出しから作った色つきのプレースホルダーを出す
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
  // url があれば画像、なければプレースホルダー。画像の読み込みに失敗したらプレースホルダーに差し替える
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
  // 高さを保ったままクルクルを挟んでから中身を入れ替える。
  // 描画前や非表示のタブでは offsetHeight が 0 や極端な値になるので、常識的な範囲に丸める
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

  function save() {
    store.set(STATE_KEY, state);
  }
  function set(patch) {
    Object.assign(state, patch);
    shown = PAGE;
    save();
    renderFilters();
    renderList();
  }

  // ---------- 絞り込み ----------
  // NGキーワードを含む記事を隠す（あとで読むに保存済みのものは対象外）
  function matchesNg(it) {
    if (!ngWords.length) return false;
    const text = `${it.title} ${it.summary || ""}`.toLowerCase();
    return ngWords.some((w) => text.includes(w.toLowerCase()));
  }

  function visible() {
    const q = state.q.trim().toLowerCase();
    return data.items.filter((it) => {
      if (state.cat !== "all" && !it.categories.includes(state.cat)) return false;
      if (state.hidePR && it.isPR) return false;
      if (matchesNg(it)) return false;
      if (q && !`${it.title} ${it.summary || ""} ${it.source}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  // おまかせ順。並べ替えのたびに変わらないよう、seed から決める
  function shuffled(list) {
    const arr = list.map((it, i) => ({ it, k: Math.sin((i + 1) * 9301 + shuffleSeed * 49297) }));
    arr.sort((a, b) => a.k - b.k);
    return arr.map((x) => x.it);
  }

  // ---------- 記事の行 ----------
  function makeRow(it) {
    const row = document.createElement("article");
    row.className = "row" + (it.isNew ? " is-new" : "");

    const thumb = thumbNode(it.image, it.title, CAT_EMOJI[it.categories[0]] || CAT_EMOJI.other, "row-thumb");

    const body = document.createElement("div");
    body.className = "row-body";

    const top = document.createElement("div");
    top.className = "row-top";
    if (it.isNew) top.appendChild(badge("NEW", "badge-new"));
    if (it.isOfficial) top.appendChild(badge("公式", "badge-official"));
    for (const s of (it.series || []).slice(0, 1)) top.appendChild(badge(labelOfSeries(s), "badge-series"));
    for (const c of it.categories.slice(0, 1)) {
      const label = labelOfCat(c);
      if (label) top.appendChild(badge(label, "badge-cat"));
    }
    if (it.isPR) top.appendChild(badge("PR", "badge-pr"));
    const src = document.createElement("span");
    src.textContent = `${it.source} ・ ${hhmm(it.publishedAt)}`;
    top.appendChild(src);

    const a = document.createElement("a");
    a.className = "row-title";
    a.href = it.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = it.title;
    a.addEventListener("click", () => markRead(it.id));

    const sum = document.createElement("p");
    sum.className = "row-sum";
    sum.textContent = it.summary || "";

    body.append(top, a, sum);

    const star = document.createElement("button");
    star.type = "button";
    star.className = "fav-btn" + (fav.includes(it.id) ? " on" : "");
    star.textContent = fav.includes(it.id) ? "★" : "☆";
    star.title = "あとで読む";
    star.addEventListener("click", () => {
      toggleFav(it.id);
      star.classList.toggle("on", fav.includes(it.id));
      star.textContent = fav.includes(it.id) ? "★" : "☆";
      onFavChanged();
    });

    row.append(thumb, body, star);
    return row;
  }

  function badge(text, cls) {
    const b = document.createElement("span");
    b.className = `badge ${cls}`;
    b.textContent = text;
    return b;
  }

  function markRead(id) {
    if (read.includes(id)) return;
    read = [id, ...read].slice(0, 400);
    store.set(READ_KEY, read);
  }
  function toggleFav(id) {
    fav = fav.includes(id) ? fav.filter((x) => x !== id) : [id, ...fav].slice(0, 200);
    store.set(FAV_KEY, fav);
  }

  // ---------- 一覧 ----------
  function renderList() {
    const all = visible();
    const ordered = state.sort === "shuffle" ? shuffled(all) : all;
    const list = ordered.slice(0, shown);
    const box = $("#list");
    box.innerHTML = "";

    const countEl = $("#count");
    countEl.innerHTML = "";
    countEl.append(`${all.length} 件`);
    if (state.q) {
      countEl.append(`「${state.q}」で絞り込み中 `);
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "q-clear";
      clear.textContent = "✕ 解除";
      clear.addEventListener("click", () => set({ q: "" }));
      countEl.appendChild(clear);
    }
    $("#empty").hidden = all.length > 0;

    if (state.sort === "shuffle") {
      const rows = document.createElement("div");
      rows.className = "rows";
      for (const it of list) rows.appendChild(makeRow(it));
      box.appendChild(rows);
    } else {
      const groups = new Map();
      for (const it of list) {
        const k = dayKey(it.publishedAt);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(it);
      }
      for (const [key, items] of groups) {
        const sec = document.createElement("section");
        sec.className = "day";
        const h = document.createElement("h3");
        h.className = "day-head";
        h.textContent = dayLabel(key);
        const rows = document.createElement("div");
        rows.className = "rows";
        for (const it of items) rows.appendChild(makeRow(it));
        sec.append(h, rows);
        box.appendChild(sec);
      }
    }

    const more = $("#listMore");
    more.hidden = all.length <= list.length;
    more.textContent = `もっと見る（残り ${all.length - list.length} 件）`;
  }

  // ---------- 注目の話題 ----------
  function renderTopics() {
    const list = (data.topics || []).filter((t) => !matchesNg({ title: t.title, summary: t.summary }));
    const sec = $("#topicsSection");
    if (!list.length) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    const grid = $("#topicGrid");
    grid.innerHTML = "";
    for (const t of list.slice(0, topicsShown)) {
      const card = document.createElement("article");
      card.className = "topic";

      const thumb = thumbNode(t.image, t.title, CAT_EMOJI[(t.categories || [])[0]] || CAT_EMOJI.other, "topic-thumb");

      const top = document.createElement("div");
      top.className = "topic-top";
      const stars = document.createElement("span");
      stars.className = "topic-stars";
      // 媒体数をそのまま★にする（最大 5 つ）
      const n = Math.min(5, t.sourceCount);
      stars.textContent = "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
      const count = document.createElement("span");
      count.className = "topic-count";
      count.textContent = `${t.sourceCount} 媒体`;
      const time = document.createElement("span");
      time.className = "topic-time";
      time.textContent = hhmm(t.publishedAt || data.updatedAt);
      top.append(stars, count, time);

      const body = document.createElement("div");
      body.className = "topic-body";
      const h = document.createElement("h3");
      h.className = "topic-title";
      const a = document.createElement("a");
      a.href = t.url || t.items?.[0]?.url || "#";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = t.title;
      h.appendChild(a);
      const sum = document.createElement("p");
      sum.className = "topic-sum";
      sum.textContent = t.summary || "";

      const links = document.createElement("ul");
      links.className = "topic-links";
      for (const it of (t.articles || []).slice(0, 4)) {
        const li = document.createElement("li");
        const s = document.createElement("span");
        s.className = "src";
        s.textContent = it.source;
        const la = document.createElement("a");
        la.href = it.url;
        la.target = "_blank";
        la.rel = "noopener noreferrer";
        la.textContent = it.title;
        la.addEventListener("click", () => markRead(it.id || it.url));
        li.append(s, la);
        links.appendChild(li);
      }

      body.append(h, sum, links);
      card.append(thumb, top, body);
      grid.appendChild(card);
    }
    const more = $("#topicMore");
    more.hidden = list.length <= topicsShown;
    more.textContent = `ほかの話題を見る（残り ${list.length - topicsShown} 件）`;
  }

  // ---------- 左カラム ----------
  function renderFilters() {
    const cl = $("#catList");
    cl.innerHTML = "";
    const cats = [{ id: "all", label: "すべて", count: data.total }, ...data.categories.filter((c) => c.count > 0)];
    for (const c of cats) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = state.cat === c.id ? "active" : "";
      b.innerHTML = `${c.label}<span class="n">${c.count}</span>`;
      b.addEventListener("click", () => set({ cat: c.id }));
      cl.appendChild(b);
    }

    const srcs = $("#srcList");
    srcs.innerHTML = "";
    for (const s of data.sources.slice(0, 12)) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${s.name}</span><span class="c">${s.count}</span>`;
      srcs.appendChild(li);
    }
    $("#sourceList").textContent = data.sources.map((s) => s.name).join(" / ");

    $("#hidePR").checked = state.hidePR;
    for (const b of document.querySelectorAll("#sortSeg button")) b.classList.toggle("active", b.dataset.sort === state.sort);
  }

  // 見出しによく出ている語。押すと検索に入る
  const STOP = new Set(["モンスターハンター", "モンハン", "ワイルズ", "モンスター", "ハンター", "ゲーム", "情報", "発表", "公開", "配信", "実施", "開始", "登場", "予定", "紹介", "今日", "本日", "最新", "対応", "シリーズ", "カプコン"]);
  function renderWords() {
    const count = new Map();
    for (const it of data.items) {
      const t = it.title.replace(/[「」『』【】（）()\[\]｜|・,.、。！!？?:：;；〜~＋+"'"']/g, " ");
      for (const m of t.matchAll(/[ァ-ヴー]{3,}|[一-龥]{2,}/g)) {
        const w = m[0];
        if (STOP.has(w) || w.length > 10) continue;
        count.set(w, (count.get(w) || 0) + 1);
      }
    }
    const top = [...count.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 18);
    if (!top.length) return;
    $("#wordMod").hidden = false;
    const box = $("#wordCloud");
    box.innerHTML = "";
    for (const [w, n] of top) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = `${w} ${n}`;
      b.addEventListener("click", () => {
        set({ q: w });
        $("#feedSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      box.appendChild(b);
    }
  }

  // ---------- 右カラム ----------
  let gachaId = "";
  function renderGacha() {
    const pool = data.items.filter((it) => !it.isPR && !matchesNg(it));
    const box = $("#gachaBody");
    box.innerHTML = "";
    if (!pool.length) return;
    // まだ開いていない記事を優先する（毎回同じものが出ないように）
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
  // 図鑑データ（dex.json）は 400KB ほどあり中身も変わらないので、
  // ニュースの表示を邪魔しないよう、本文を描いたあとに遅延して読み込む
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

    const search = document.createElement("button");
    search.type = "button";
    search.className = "dex-search";
    search.textContent = `「${e.name}」のニュースを探す`;
    search.addEventListener("click", () => {
      set({ q: e.name });
      $("#feedSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    card.append(img, no, name, types, size, flavor, search);
    box.appendChild(card);
  }

  function updateFavCount() {
    const el = $("#favCount");
    el.hidden = fav.length === 0;
    el.textContent = String(fav.length);
  }

  function renderFavView() {
    const box = $("#favViewBody");
    box.innerHTML = "";
    const items = fav.map((id) => data.items.find((it) => it.id === id)).filter(Boolean);
    $("#favViewEmpty").hidden = items.length > 0;
    if (!items.length) return;
    const rows = document.createElement("div");
    rows.className = "rows";
    for (const it of items) rows.appendChild(makeRow(it));
    box.appendChild(rows);
  }

  function onFavChanged() {
    updateFavCount();
    if (favViewOpen) renderFavView();
  }

  // ---------- あとで読む（中央エリアだけを差し替える簡易ルーティング） ----------
  let favViewOpen = false;
  const BASE_TITLE = document.title;
  function showFavView() {
    favViewOpen = true;
    for (const id of ["topicsSection", "feedSection"]) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    }
    $("#favView").hidden = false;
    renderFavView();
    document.title = `あとで読む｜${BASE_TITLE}`;
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function hideFavView() {
    favViewOpen = false;
    $("#favView").hidden = true;
    $("#topicsSection").hidden = !(data?.topics?.length);
    $("#feedSection").hidden = false;
    document.title = BASE_TITLE;
  }
  function syncFavView() {
    if (location.hash === "#favorites") showFavView();
    else hideFavView();
  }

  // ---------- NGキーワード ----------
  function renderNg() {
    const box = $("#ngList");
    box.innerHTML = "";
    for (const w of ngWords) {
      const chip = document.createElement("span");
      chip.className = "ng-chip";
      chip.textContent = w;
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "×";
      del.title = "削除";
      del.addEventListener("click", () => {
        ngWords = ngWords.filter((x) => x !== w);
        store.set(NG_KEY, ngWords);
        renderNg();
        shown = PAGE;
        renderTopics();
        renderList();
      });
      chip.appendChild(del);
      box.appendChild(chip);
    }
  }

  // ---------- 更新の様子 ----------
  function renderChurn() {
    const c = data.churn;
    const el = $("#churn");
    if (!c || !c.previousCount) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = `前回から <b>${c.newCount}</b> 本が新着`;
  }

  // ---------- 起動 ----------
  async function boot() {
    $("#year").textContent = new Date().getFullYear();
    renderNg();

    try {
      const r = await fetch(`data/news.json?t=${Math.floor(Date.now() / 300000)}`);
      data = await r.json();
    } catch {
      $("#meta").textContent = "データを読み込めませんでした。";
      $("#list").innerHTML = "";
      $("#empty").hidden = false;
      $("#empty").textContent = "ニュースを読み込めませんでした。時間をおいて開き直してください。";
      return;
    }

    const u = new Date(data.updatedAt);
    $("#meta").textContent = `${data.total} 本のニュース ・ 今日 ${data.todayCount} 本 ・ ${data.topics.length} の話題 ・ 最終更新 ${u.getMonth() + 1}/${u.getDate()} ${hhmm(data.updatedAt)}`;

    renderChurn();
    renderFilters();
    renderWords();
    renderTopics();
    renderList();
    renderGacha();
    // 図鑑は後回しにして、ニュースの表示を先に終わらせる
    loadDex().then(renderDex);
    updateFavCount();
    syncFavView();
  }

  // ---------- 操作 ----------
  window.addEventListener("hashchange", syncFavView);
  $("#favBack").addEventListener("click", () => {
    history.replaceState(null, "", location.pathname + location.search);
    hideFavView();
  });
  document.querySelectorAll(".global-nav a").forEach((a) => a.addEventListener("click", () => hideFavView()));
  $("#ngForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#ngInput");
    const w = input.value.trim();
    input.value = "";
    if (!w || ngWords.includes(w)) return;
    ngWords = [...ngWords, w].slice(0, 30);
    store.set(NG_KEY, ngWords);
    renderNg();
    shown = PAGE;
    renderTopics();
    renderList();
  });
  $("#hidePR").addEventListener("change", (e) => set({ hidePR: e.target.checked }));
  for (const b of document.querySelectorAll("#sortSeg button")) {
    b.addEventListener("click", () => {
      shuffleSeed = Math.random();
      set({ sort: b.dataset.sort });
    });
  }
  $("#listMore").addEventListener("click", () => {
    shown += PAGE;
    renderList();
  });
  $("#topicMore").addEventListener("click", () => {
    topicsShown += 4;
    renderTopics();
  });
  $("#gachaAgain").addEventListener("click", () => swapWithSpinner($("#gachaBody"), renderGacha));
  $("#dexAgain").addEventListener("click", () => swapWithSpinner($("#dexBody"), renderDex, { min: 210, max: 360 }));
  $("#dexRare").addEventListener("change", () => swapWithSpinner($("#dexBody"), renderDex, { min: 210, max: 360 }));
  const toTop = $("#toTop");
  const onScroll = () => (toTop.hidden = window.scrollY < 500);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  boot();
})();
