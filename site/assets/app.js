(() => {
  const $ = (s) => document.querySelector(s);
  const PAGE = 40;
  const TOPICS_FIRST = 5;
  const SPIN_MS = 320;
  const FAV_KEY = "poke:fav";
  const READ_KEY = "poke:read";
  const STATE_KEY = "poke:state";
  const NG_KEY = "poke:ng";

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

  let fav = store.get(FAV_KEY, []);
  let read = store.get(READ_KEY, []);
  let ngWords = store.get(NG_KEY, []);
  const state = Object.assign({ series: "all", cat: "all", q: "", sort: "new" }, store.get(STATE_KEY, {}));

  // 権利元・運営が自分で出した告知。ここから来たものは「公式発表」として大きく扱う
  const OFFICIAL_HOSTS = [
    "pokemon.co.jp", "pokemon.com", "pokemon-card.com", "pokemongolive.com",
    "pokemonunite.jp", "pokemon-sleep.net", "pokemoncenter-online.com",
    "nintendo.com", "nintendo.co.jp", "gamefreak.co.jp", "creatures.co.jp",
  ];
  // 攻略記事・カードの相場記事。毎日たくさん流れてくるので、一覧では小さく扱う
  const GUIDE_HOSTS = ["gamewith.jp", "appmedia.jp", "snkrdunk.com", "game8.jp", "altema.jp", "gamerch.com"];
  const GUIDE_TITLE = /買取|相場|値段|価格推移|厳選|育成論|最強|ランキング|一覧|入手方法|個体値/;
  const VIDEO_HOSTS = ["youtu.be", "youtube.com"];

  function hostIn(host, list) {
    const h = (host || "").toLowerCase();
    return list.some((o) => h === o || h.endsWith(`.${o}`));
  }
  const isOfficial = (it) => !!it.isOfficial || hostIn(it.host, OFFICIAL_HOSTS);
  const isGuide = (it) =>
    hostIn(it.host, GUIDE_HOSTS) || (it.categories || []).includes("guide") || GUIDE_TITLE.test(it.title);
  const isVideo = (it) => hostIn(it.host, VIDEO_HOSTS);

  // ---------- 時刻 ----------
  function hhmm(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function mdhm(iso) {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${hhmm(iso)}`;
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
    if (diff === 0) return `きょう ${m}月${d}日（${wd}）`;
    if (diff === 1) return `きのう ${m}月${d}日（${wd}）`;
    return `${m}月${d}日（${wd}）`;
  }

  const labelOfCat = (id) => data.categories.find((c) => c.id === id)?.label || "";
  const labelOfSeries = (id) => data.series.find((s) => s.id === id)?.label || "";
  const seriesOf = (it) => (it.series || [])[0] || "";
  const seriesClass = (id) => `s-${id || "none"}`;

  // ---------- 話題（クラスタ）の索引 ----------
  // 記事がどの話題に属しているかを URL から引けるようにしておく。
  // 一覧の扱いの大小も、ここで決まった「話題の中心かどうか」で決める。
  let topicByUrl = new Map();
  function indexTopics() {
    topicByUrl = new Map();
    (data.topics || []).forEach((t, i) => {
      topicByUrl.set(t.url, { topic: t, rank: i, isLead: true });
      for (const a of t.articles || []) {
        if (!topicByUrl.has(a.url)) topicByUrl.set(a.url, { topic: t, rank: i, isLead: false });
      }
    });
  }
  const topicOf = (it) => topicByUrl.get(it.url) || null;

  // 話題に集まった記事を、古い順に並べ直す（初報 → 最新の流れを見せるため）
  function flowOf(t) {
    const arts = (t.articles || []).map((a) => ({ ...a }));
    if (t.leadPublishedAt) {
      arts.push({ title: t.title, url: t.url, source: t.leadSource, publishedAt: t.leadPublishedAt, isLead: true });
    }
    arts.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
    return arts;
  }
  function firstReport(t) {
    const flow = flowOf(t);
    const at = t.firstAt || flow[0]?.publishedAt || t.publishedAt;
    const hit = flow.find((a) => a.publishedAt === at);
    return { at, source: hit?.source || t.leadSource || "" };
  }
  function lastReport(t) {
    const flow = flowOf(t);
    const at = t.publishedAt;
    const hit = [...flow].reverse().find((a) => a.publishedAt === at);
    return { at, source: hit?.source || t.leadSource || "" };
  }

  // ---------- 記事の扱いの大きさ ----------
  // 3 = この日の中心（話題の代表記事・公式発表）
  // 2 = ふつうのニュース
  // 1 = 小さく流すもの（攻略・相場・同じ話題の重複・PR・分類できなかったもの）
  function tierOf(it) {
    if (it.isPR) return 1;
    if (isOfficial(it)) return 3;
    // 攻略サイトの記事でも、複数の媒体が報じた話題の中心なら大きく扱う
    const t = topicOf(it);
    if (t && t.isLead && t.rank < 6) return 3;
    if (isGuide(it)) return 1;
    if (t) return 2;
    if (!it.image) return 1;
    if ((it.categories || []).length === 1 && it.categories[0] === "other" && !(it.series || []).length) return 1;
    return 2;
  }

  // ---------- 小物 ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function extLink(cls, url, text, id) {
    const a = el("a", cls, text);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    if (id) a.addEventListener("click", () => markRead(id));
    return a;
  }
  function mark(text, cls) {
    return el("span", `mark ${cls}`, text);
  }
  // 画像。読み込めなかったときは枠ごと消す（代わりの絵は出さない）
  function thumbNode(url, cls, href, id) {
    if (!url) return null;
    const box = href ? extLink(cls, href, null, id) : el("div", cls);
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => box.remove());
    box.appendChild(img);
    return box;
  }
  function spinnerNode() {
    const sp = el("span", "spinner");
    sp.setAttribute("role", "status");
    sp.setAttribute("aria-label", "読み込み中");
    return sp;
  }
  // 高さを保ったままクルクルを挟んでから中身を入れ替える
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
    renderNav();
    renderList();
  }

  // ---------- 絞り込み ----------
  function matchesNg(it) {
    if (!ngWords.length) return false;
    const text = `${it.title} ${it.summary || ""}`.toLowerCase();
    return ngWords.some((w) => text.includes(w.toLowerCase()));
  }

  function visible() {
    const q = state.q.trim().toLowerCase();
    return data.items.filter((it) => {
      if (state.series !== "all" && !(it.series || []).includes(state.series)) return false;
      if (state.cat !== "all" && !it.categories.includes(state.cat)) return false;
      if (matchesNg(it)) return false;
      if (q && !`${it.title} ${it.summary || ""} ${it.source}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function shuffled(list) {
    const arr = list.map((it, i) => ({ it, k: Math.sin((i + 1) * 9301 + shuffleSeed * 49297) }));
    arr.sort((a, b) => a.k - b.k);
    return arr.map((x) => x.it);
  }

  // ---------- トップ記事 ----------
  function renderLead() {
    const sec = $("#leadSection");
    const t = (data.topics || []).find((x) => !matchesNg({ title: x.title, summary: x.summary }));
    if (!t) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    const box = $("#leadBody");
    box.innerHTML = "";

    const sid = seriesOfTopic(t);
    const art = el("article", `lead-art ${seriesClass(sid)}`);

    const text = el("div", "lead-text");
    const eyebrow = el("p", "lead-eyebrow");
    if (sid) eyebrow.appendChild(el("span", "series-tag", labelOfSeries(sid)));
    eyebrow.appendChild(mark(`${t.sourceCount} 媒体が報じています`, "mark-spread"));
    for (const c of (t.categories || []).slice(0, 1)) {
      const l = labelOfCat(c);
      if (l && l !== "その他") eyebrow.appendChild(el("span", "cat-tag", l));
    }

    const h = el("h2", "lead-title");
    h.appendChild(extLink(null, t.url, t.title, t.id));

    const sum = el("p", "lead-sum", t.summary || "");

    const first = firstReport(t);
    const last = lastReport(t);
    const track = el("dl", "track");
    track.appendChild(trackRow("初報", first.at, first.source));
    if (first.at !== last.at) track.appendChild(trackRow("最新", last.at, last.source));
    const cnt = el("div");
    cnt.append(el("dt", null, "記事"), el("dd", null, `${t.articleCount} 本`));
    track.appendChild(cnt);

    text.append(eyebrow, h, sum, track);

    const flow = flowOf(t).filter((a) => a.url !== t.url).reverse().slice(0, 4);
    if (flow.length) {
      const ul = el("ul", "lead-arts");
      for (const a of flow) {
        const li = el("li");
        li.append(el("span", "src", a.source), extLink(null, a.url, a.title));
        ul.appendChild(li);
      }
      text.appendChild(ul);
    }

    art.appendChild(text);
    const thumb = thumbNode(t.image, "lead-thumb", t.url, t.id);
    if (thumb) art.appendChild(thumb);
    else art.style.gridTemplateColumns = "minmax(0, 1fr)";
    box.appendChild(art);
  }

  function trackRow(label, at, source) {
    const d = el("div");
    const dd = el("dd");
    dd.appendChild(el("b", null, mdhm(at)));
    if (source) dd.append(` ${source}`);
    d.append(el("dt", null, label), dd);
    return d;
  }

  // 話題に集まった記事から、いちばん多いタイトル（本編 / GO / ポケカ …）を選ぶ
  function seriesOfTopic(t) {
    const hit = data.items.find((it) => it.url === t.url);
    if (hit && (hit.series || []).length) return hit.series[0];
    for (const a of t.articles || []) {
      const m = data.items.find((it) => it.url === a.url);
      if (m && (m.series || []).length) return m.series[0];
    }
    return "";
  }

  // ---------- 追いかけている話題 ----------
  function renderTopics() {
    const all = (data.topics || []).filter((t) => !matchesNg({ title: t.title, summary: t.summary }));
    const list = all.slice(1); // 1 件目はトップ記事に出しているので外す
    const sec = $("#topicsSection");
    if (!list.length) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    const box = $("#topicList");
    box.innerHTML = "";

    list.slice(0, topicsShown).forEach((t, i) => {
      const sid = seriesOfTopic(t);
      const li = el("li", `topic ${seriesClass(sid)}`);
      li.appendChild(el("div", "topic-rank", String(i + 2).padStart(2, "0")));

      const main = el("div", "topic-main");

      const meta = el("div", "topic-meta");
      if (sid) meta.appendChild(el("span", "series-tag", labelOfSeries(sid)));
      for (const c of (t.categories || []).slice(0, 2)) {
        const l = labelOfCat(c);
        if (l && l !== "その他") meta.appendChild(el("span", "cat-tag", l));
      }

      const h = el("h3", "topic-title");
      h.appendChild(extLink(null, t.url, t.title, t.id));

      // 媒体数のものさし。段階評価ではなく、報じた媒体の数をそのまま並べる
      const spread = el("div", "spread");
      const bar = el("span", "spread-bar");
      for (let k = 0; k < Math.min(14, t.sourceCount); k++) bar.appendChild(el("i"));
      spread.append(bar, el("span", "spread-n", `${t.sourceCount} 媒体`), el("span", "src", `${t.articleCount} 本`));

      const first = firstReport(t);
      const last = lastReport(t);
      const range = el("div", "topic-range");
      if (first.at === last.at) range.append(`${mdhm(first.at)} ${first.source} が報じました`);
      else range.append(`初報 ${mdhm(first.at)} ${first.source}`, el("span", "to", "→"), `最新 ${mdhm(last.at)} ${last.source}`);

      const flowList = flowOf(t);
      main.append(meta, h, spread, range);

      if (flowList.length) {
        const toggle = el("button", "topic-toggle", `報道の流れを見る（${flowList.length} 本）`);
        toggle.type = "button";
        const ol = el("ol", "topic-flow");
        ol.hidden = true;
        flowList.forEach((a, k) => {
          const row = el("li", k === 0 ? "is-first" : "");
          const time = el("time", null, mdhm(a.publishedAt));
          time.dateTime = a.publishedAt;
          row.append(time, el("span", "src", a.source), extLink(null, a.url, a.title));
          ol.appendChild(row);
        });
        toggle.addEventListener("click", () => {
          ol.hidden = !ol.hidden;
          toggle.textContent = ol.hidden ? `報道の流れを見る（${flowList.length} 本）` : "報道の流れを閉じる";
        });
        main.append(toggle, ol);
      }

      li.appendChild(main);
      const thumb = thumbNode(t.image, "topic-thumb", t.url, t.id);
      if (thumb) li.appendChild(thumb);
      box.appendChild(li);
    });

    const more = $("#topicMore");
    more.hidden = list.length <= topicsShown;
    more.textContent = `ほかの話題を見る（残り ${list.length - topicsShown} 件）`;
  }

  // ---------- 一覧（時系列） ----------
  function makeItem(it, forcedTier) {
    const tier = forcedTier || tierOf(it);
    const sid = seriesOf(it);
    const li = el("li", `tl t${tier} ${seriesClass(sid)}`);

    const time = el("time", "tl-time", hhmm(it.publishedAt));
    time.dateTime = it.publishedAt;

    const main = el("div", "tl-main");
    const text = el("div", "tl-text");

    const meta = el("div", "tl-meta");
    if (sid) meta.appendChild(el("span", "series-tag", labelOfSeries(sid)));
    meta.appendChild(el("span", "src", it.source));
    for (const c of it.categories.slice(0, 1)) {
      const l = labelOfCat(c);
      if (l && l !== "その他") meta.appendChild(el("span", "cat-tag", l));
    }
    if (isOfficial(it)) meta.appendChild(mark("公式発表", "mark-official"));
    const t = topicOf(it);
    if (t) meta.appendChild(mark(`${t.topic.sourceCount} 媒体が報道`, "mark-spread"));
    if (isVideo(it)) meta.appendChild(mark("動画", "mark-video"));
    if (it.isPR) meta.appendChild(mark("PR", "mark-pr"));
    if (it.isNew) meta.appendChild(mark("NEW", "mark-new"));

    const h = el("h3", "tl-title");
    h.appendChild(extLink(null, it.url, it.title, it.id));

    text.append(meta, h);
    if (tier > 1 && it.summary) text.appendChild(el("p", "tl-sum", it.summary));

    main.appendChild(text);
    if (tier > 1) {
      const thumb = thumbNode(it.image, "tl-thumb", it.url, it.id);
      if (thumb) main.appendChild(thumb);
    }
    main.appendChild(laterBtn(it));

    li.append(time, main);
    return li;
  }

  function laterBtn(it) {
    const b = el("button", "later-btn" + (fav.includes(it.id) ? " on" : ""), fav.includes(it.id) ? "✓" : "＋");
    b.type = "button";
    b.title = "あとで読む";
    b.setAttribute("aria-label", "あとで読むに入れる");
    b.addEventListener("click", () => {
      toggleFav(it.id);
      const on = fav.includes(it.id);
      b.classList.toggle("on", on);
      b.textContent = on ? "✓" : "＋";
      onFavChanged();
    });
    return b;
  }

  function renderList() {
    const all = visible();
    const ordered = state.sort === "shuffle" ? shuffled(all) : all;
    const list = ordered.slice(0, shown);
    const box = $("#list");
    box.innerHTML = "";

    const countEl = $("#count");
    countEl.innerHTML = "";
    countEl.append(`${all.length} 本`);
    if (state.q) {
      countEl.append(`　「${state.q}」で絞り込み中`);
      const clear = el("button", "q-clear", "解除");
      clear.type = "button";
      clear.addEventListener("click", () => set({ q: "" }));
      countEl.appendChild(clear);
    }
    $("#empty").hidden = all.length > 0;

    if (state.sort === "shuffle") {
      const rows = el("ol", "rows");
      for (const it of list) rows.appendChild(makeItem(it));
      box.appendChild(rows);
    } else {
      const groups = new Map();
      for (const it of list) {
        const k = dayKey(it.publishedAt);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(it);
      }
      for (const [key, items] of groups) {
        const sec = el("section", "day");
        sec.appendChild(el("h3", "day-head", dayLabel(key)));
        const ol = el("ol", "day-items");
        for (const it of items) ol.appendChild(makeItem(it));
        sec.appendChild(ol);
        box.appendChild(sec);
      }
    }

    const more = $("#listMore");
    more.hidden = all.length <= list.length;
    more.textContent = `もっと見る（残り ${all.length - list.length} 本）`;
  }

  // ---------- ナビ・絞り込み ----------
  function renderNav() {
    const nav = $("#seriesNav");
    nav.innerHTML = "";
    const all = [{ id: "all", label: "すべて", count: data.total }, ...data.series.filter((s) => s.count > 0)];
    for (const s of all) {
      const b = el("button", `${seriesClass(s.id === "all" ? "" : s.id)}${state.series === s.id ? " active" : ""}`);
      b.type = "button";
      b.append(s.label, el("span", "n", String(s.count)));
      b.addEventListener("click", () => {
        set({ series: s.id });
        if (state.series !== "all") $("#feedSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      nav.appendChild(b);
    }

    const cl = $("#catList");
    cl.innerHTML = "";
    const cats = [{ id: "all", label: "種別すべて", count: data.total }, ...data.categories.filter((c) => c.count > 0)];
    for (const c of cats) {
      const b = el("button", state.cat === c.id ? "active" : "");
      b.type = "button";
      b.append(c.label, el("span", "n", String(c.count)));
      b.addEventListener("click", () => set({ cat: c.id }));
      cl.appendChild(b);
    }

    $("#sourceList").textContent = data.sources.map((s) => s.name).join(" / ");
    for (const b of document.querySelectorAll("#sortSeg button")) b.classList.toggle("active", b.dataset.sort === state.sort);
  }

  // 見出しによく出ている語。押すと検索に入る
  const STOP = new Set(["ポケモン", "ポケットモンスター", "ゲーム", "情報", "発表", "公開", "配信", "実施", "開始", "登場", "予定", "紹介", "今日", "本日", "最新", "対応", "シリーズ", "販売", "商品", "価格"]);
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
    const top = [...count.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 16);
    if (!top.length) return;
    $("#wordMod").hidden = false;
    const box = $("#wordCloud");
    box.innerHTML = "";
    for (const [w, n] of top) {
      const b = el("button");
      b.type = "button";
      b.append(w, el("span", "n", String(n)));
      b.addEventListener("click", () => {
        set({ q: w });
        $("#feedSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      box.appendChild(b);
    }
  }

  // ---------- 補助の欄 ----------
  let gachaId = "";
  function renderGacha() {
    const pool = data.items.filter((it) => !it.isPR && !matchesNg(it));
    const box = $("#gachaBody");
    box.innerHTML = "";
    if (!pool.length) return;
    const unread = pool.filter((it) => !read.includes(it.id) && it.id !== gachaId);
    const from = unread.length ? unread : pool.filter((it) => it.id !== gachaId);
    const it = (from.length ? from : pool)[Math.floor(Math.random() * (from.length || pool.length))];
    gachaId = it.id;

    const a = extLink("gacha-item", it.url, null, it.id);
    const thumb = thumbNode(it.image, "gacha-thumb");
    if (thumb) a.appendChild(thumb);
    const info = el("div", "gacha-info");
    info.append(el("div", "gacha-meta", `${it.source} ・ ${hhmm(it.publishedAt)}`), el("div", "gacha-title", it.title));
    a.appendChild(info);
    box.appendChild(a);
  }

  async function renderOtherNews() {
    let other;
    try {
      const r = await fetch(`data/other.json?t=${Math.floor(Date.now() / 300000)}`);
      other = await r.json();
    } catch {
      return;
    }
    const items = (other.items || []).slice(0, 5);
    if (!items.length) return;
    $("#otherMod").hidden = false;
    const box = $("#otherList");
    box.innerHTML = "";
    for (const it of items) {
      const li = el("li");
      li.append(el("div", "other-meta", `${it.source} ・ ${hhmm(it.publishedAt)}`), extLink(null, it.url, it.title));
      box.appendChild(li);
    }
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
      box.appendChild(el("p", "mod-desc", "図鑑データを読み込めませんでした。"));
      return;
    }
    const rareOnly = $("#dexRare").checked;
    const pool = rareOnly ? dex.filter((e) => e.isLegendary || e.isMythical) : dex;
    const from = pool.filter((e) => e.id !== dexId);
    const e = from[Math.floor(Math.random() * from.length)] || pool[0];
    if (!e) return;
    dexId = e.id;

    const card = el("div", "dex-card");
    const img = document.createElement("img");
    img.className = "dex-img";
    img.src = e.image;
    img.alt = e.name;
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";

    const name = el("div", "dex-name", e.name);
    if (e.isLegendary || e.isMythical) name.appendChild(el("span", "dex-rare", e.isMythical ? "幻" : "伝説"));

    const types = el("div", "dex-types");
    for (const t of e.types || []) types.appendChild(el("span", "dex-type", t));

    card.append(
      img,
      el("div", "dex-no", `No.${String(e.id).padStart(4, "0")}`),
      name,
      types,
      el("div", "dex-size", `${e.genus ? `${e.genus} ・ ` : ""}高さ ${e.height}m ・ 重さ ${e.weight}kg`),
      el("p", "dex-flavor", e.flavor || "")
    );
    box.appendChild(card);
  }

  // ---------- あとで読む ----------
  function markRead(id) {
    if (!id || read.includes(id)) return;
    read = [id, ...read].slice(0, 400);
    store.set(READ_KEY, read);
  }
  function toggleFav(id) {
    fav = fav.includes(id) ? fav.filter((x) => x !== id) : [id, ...fav].slice(0, 200);
    store.set(FAV_KEY, fav);
  }
  function updateFavCount() {
    const el2 = $("#favCount");
    el2.hidden = fav.length === 0;
    el2.textContent = String(fav.length);
  }
  function renderFavView() {
    const box = $("#favViewBody");
    box.innerHTML = "";
    const items = fav.map((id) => data.items.find((it) => it.id === id)).filter(Boolean);
    $("#favViewEmpty").hidden = items.length > 0;
    if (!items.length) return;
    const ol = el("ol", "rows");
    for (const it of items) ol.appendChild(makeItem(it, 2));
    box.appendChild(ol);
  }
  function onFavChanged() {
    updateFavCount();
    if (favViewOpen) renderFavView();
  }

  let favViewOpen = false;
  const BASE_TITLE = document.title;
  function showFavView() {
    favViewOpen = true;
    for (const id of ["leadSection", "topicsSection", "feedSection"]) {
      const n = document.getElementById(id);
      if (n) n.hidden = true;
    }
    $("#favView").hidden = false;
    renderFavView();
    document.title = `あとで読む｜${BASE_TITLE}`;
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function hideFavView() {
    favViewOpen = false;
    $("#favView").hidden = true;
    $("#leadSection").hidden = !(data?.topics?.length);
    $("#topicsSection").hidden = !((data?.topics || []).length > 1);
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
      const chip = el("span", "ng-chip", w);
      const del = el("button", null, "×");
      del.type = "button";
      del.title = "削除";
      del.addEventListener("click", () => {
        ngWords = ngWords.filter((x) => x !== w);
        store.set(NG_KEY, ngWords);
        renderNg();
        redrawNews();
      });
      chip.appendChild(del);
      box.appendChild(chip);
    }
  }
  function redrawNews() {
    shown = PAGE;
    renderLead();
    renderTopics();
    renderList();
  }

  function renderChurn() {
    const c = data.churn;
    const n = $("#churn");
    if (!c || !c.previousCount) {
      n.hidden = true;
      return;
    }
    n.hidden = false;
    n.innerHTML = `前回から <b>${c.newCount}</b> 本`;
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

    indexTopics();

    const u = new Date(data.updatedAt);
    $("#meta").textContent = `${u.getMonth() + 1}月${u.getDate()}日 ${hhmm(data.updatedAt)} 更新 ・ ${data.total} 本を掲載中（きょう ${data.todayCount} 本）・ 追いかけている話題 ${data.topics.length} 件`;

    renderChurn();
    renderNav();
    renderWords();
    renderLead();
    renderTopics();
    renderList();
    renderGacha();
    // 図鑑・別記事の一覧は後回しにして、ニュースの表示を先に終わらせる
    loadDex().then(renderDex);
    renderOtherNews();
    updateFavCount();
    syncFavView();
  }

  // ---------- 操作 ----------
  window.addEventListener("hashchange", syncFavView);
  $("#favBack").addEventListener("click", () => {
    history.replaceState(null, "", location.pathname + location.search);
    hideFavView();
  });
  $("#ngForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#ngInput");
    const w = input.value.trim();
    input.value = "";
    if (!w || ngWords.includes(w)) return;
    ngWords = [...ngWords, w].slice(0, 30);
    store.set(NG_KEY, ngWords);
    renderNg();
    redrawNews();
  });
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
    topicsShown += 5;
    renderTopics();
  });
  $("#gachaAgain").addEventListener("click", () => swapWithSpinner($("#gachaBody"), renderGacha));
  $("#dexAgain").addEventListener("click", () => swapWithSpinner($("#dexBody"), renderDex, { min: 210, max: 360 }));
  $("#dexRare").addEventListener("change", () => swapWithSpinner($("#dexBody"), renderDex, { min: 210, max: 360 }));

  const toTop = $("#toTop");
  const onScroll = () => (toTop.hidden = window.scrollY < 600);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  boot();
})();
