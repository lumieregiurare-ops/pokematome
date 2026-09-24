// 検索エンジン向けの静的ページを docs/ に書き出す。収集（collect.mjs）とビルド（build.mjs）の最後に呼ぶ。
// トップの画面は app.js が news.json を読んで描くが、それだけだと検索エンジンからは中身が
// 「読み込み中…」にしか見えないので、記事の一覧を HTML にも書いておく（app.js が描き直す）。
// あわせて、タイトル（シリーズ）別・ニュースの種別・名前別（ポケモン / モンスター）・日別の過去ニュースの
// ページと、sitemap.xml・feed.xml を作る。Node の標準機能だけで動く（GitHub Actions の収集で npm ci しないため）。
//
// ヘッダーとフッターは site/index.html から切り出して使うので、見た目を変えるときは index.html を直せばよい。
// ページの文言は config.json の pages に書く（series / genres / entities）。
// このファイルは pokematome と mhmatome で同じものを使っている（違いは config.json の pages だけ）。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { loadArchive, jstDay } from "./archive.mjs";

export function minifyHtml(html) {
  return html
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, "") // 条件付きコメント以外のコメントを除去
    .replace(/>\s+</g, "><") // タグ間の空白
    .replace(/\s{2,}/g, " ")
    .trim();
}

const WD = ["日", "月", "火", "水", "木", "金", "土"];
// シリーズ・種別のページに載せる件数と、さかのぼる日数
const LIST_MAX = 60;
const LIST_DAYS = 180;
// これより記事が少ないページは noindex にして sitemap にも載せない（中身の薄いページを検索に出さない）
const MIN_INDEXABLE = 3;

// ---------- 小物 ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function jst(iso) {
  return new Date(new Date(iso).getTime() + 9 * 3600000);
}
const pad = (n) => String(n).padStart(2, "0");
function hhmm(iso) {
  const d = jst(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function dayParts(day) {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d, wd: WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
}
const mdw = (day) => {
  const p = dayParts(day);
  return `${p.m}/${p.d}（${p.wd}）`;
};
const jpDay = (day) => {
  const p = dayParts(day);
  return `${p.y}年${p.m}月${p.d}日（${p.wd}）`;
};
const dayPath = (day) => day.replace(/-/g, "/");
function truncate(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function ld(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
}
async function readText(p) {
  try {
    return await readFile(p, "utf8");
  } catch {
    return "";
  }
}
async function readJsonOr(p, fallback) {
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return fallback;
  }
}
async function verOf(p) {
  const t = await readText(p);
  return t ? createHash("sha1").update(t).digest("hex").slice(0, 8) : "0";
}
function hash32(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
function firstGlyph(str, fallback = "?") {
  return [...(str || "").trim()].find((c) => !/[「『【\[(（"'“”‘’\s]/.test(c)) || fallback;
}

// ---------- 本体 ----------
export async function renderPages(root, { log = () => {} } = {}) {
  const config = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
  const P = config.pages || {};
  const DOCS = join(root, "docs");
  const SITE = config.site?.title || "";
  const BASE = (config.site?.url || "/").replace(/\/?$/, "/");
  const abs = (path) => BASE + path.replace(/^\//, "");
  const now = new Date();
  const nowMs = now.getTime();
  const year = jst(now.toISOString()).getUTCFullYear();

  const news = await readJsonOr(join(DOCS, "data", "news.json"), null);
  const archive = await loadArchive(join(root, "data", "archive"));
  const indexTpl = await readText(join(root, "site", "index.html"));
  if (!indexTpl) return [];
  const ver = {
    css: await verOf(join(DOCS, "assets", "app.css")),
    app: await verOf(join(DOCS, "assets", "app.js")),
  };

  // ---------- データの下ごしらえ ----------
  const catLabel = (id) => (config.categories || []).find((c) => c.id === id)?.label || "";
  const seriesLabel = (id) => (config.series || []).find((c) => c.id === id)?.label || "";
  const genres = (config.categories || []).filter((c) => P.genres?.[c.id]).map((c) => ({ ...c, ...P.genres[c.id] }));
  const seriesPages = (config.series || []).filter((s) => P.series?.[s.id]).map((s) => ({ ...s, ...P.series[s.id] }));

  const seen = new Set();
  const all = [];
  for (const d of archive)
    for (const it of d.items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      all.push(it);
    }
  all.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  const recent = all.filter((it) => nowMs - new Date(it.publishedAt).getTime() <= LIST_DAYS * 86400000);
  const monthAgo = nowMs - 30 * 86400000;
  const countIn = (pred) => recent.filter((it) => new Date(it.publishedAt).getTime() >= monthAgo && pred(it)).length;

  // 名前別（ポケモン / モンスター）。見出し・要約に名前が出てくる記事を集める。
  // 「ミュウ」と「ミュウツー」のように、長い名前の一部になっている短い名前は数えない
  const E = P.entities;
  let entities = [];
  if (E) {
    let names = [];
    if (E.from === "dex") {
      const dex = await readJsonOr(join(DOCS, "data", "dex.json"), { entries: [] });
      names = (dex.entries || []).map((e) => ({ name: e.name, slug: String(e.id) }));
    } else if (E.from === "appjs") {
      const js = await readText(join(root, "site", "assets", "app.js"));
      const m = js.match(new RegExp(`const ${E.var}\\s*=\\s*(\\[[^\\]]*\\])`));
      names = m ? JSON.parse(m[1]).map((name) => ({ name, slug: createHash("sha1").update(name).digest("hex").slice(0, 8) })) : [];
    }
    const exclude = new Set(E.exclude || []);
    names = names.filter((n) => [...n.name].length >= (E.minLength || 2) && !exclude.has(n.name));
    // 前後にカタカナが続くものは別の語の一部なので数えない（「ポケモンスリープ」の「スリープ」など）
    for (const n of names) n.re = new RegExp(`(?<![ァ-ヴー])${n.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![ァ-ヴー])`);
    const hits = new Map();
    for (const it of recent) {
      const text = `${it.title} ${it.summary || ""}`;
      const found = names.filter((n) => n.re.test(text));
      for (const n of found) {
        if (found.some((o) => o !== n && o.name.includes(n.name))) continue;
        if (!hits.has(n.slug)) hits.set(n.slug, { ...n, items: [] });
        hits.get(n.slug).items.push(it);
      }
    }
    entities = [...hits.values()].filter((e) => e.items.length >= MIN_INDEXABLE).sort((a, b) => b.items.length - a.items.length);
  }
  const entityUrl = (e) => `/${E.path}/${e.slug}/`;

  // ---------- テンプレート（site/index.html）からヘッダー・フッターを切り出す ----------
  const siteLinks = [
    ...seriesPages.map((s) => [`/${s.slug}/`, s.label]),
    ...genres.map((g) => [`/news/${g.slug}/`, g.label]),
    ...(E && entities.length ? [[`/${E.path}/`, E.navLabel || E.label]] : []),
    ["/archive/", "過去のニュース"],
  ];
  const navLinks = () => siteLinks.map(([h, t]) => `<a href="${h}">${esc(t)}</a>`).join("");
  function footerLinks() {
    return `<nav class="footer-nav" aria-label="サイト内のページ">
      <a href="/">トップ</a>
      ${seriesPages.map((s) => `<a href="/${s.slug}/">${esc(s.title)}</a>`).join("")}
      ${genres.map((g) => `<a href="/news/${g.slug}/">${esc(g.title)}</a>`).join("")}
      ${E && entities.length ? `<a href="/${E.path}/">${esc(E.indexTitle)}</a>` : ""}
      <a href="/archive/">過去のニュース</a><a href="/about/">このサイトについて</a><a href="/feed.xml">RSS</a>
    </nav>`;
  }
  const sources = (news?.sources || []).map((s) => s.name);
  const tplHeader = (indexTpl.match(/<header class="header">[\s\S]*?<\/header>/) || [""])[0];
  const tplFooter = (indexTpl.match(/<footer class="footer">[\s\S]*?<\/footer>/) || [""])[0];
  const headerHtml = tplHeader
    .replace(/<h1 class="logo">([\s\S]*?)<\/h1>/, '<div class="logo">$1</div>')
    .replace('href="./"', 'href="/"')
    .replace('href="#favorites"', 'href="/#favorites"')
    .replace(/<nav class="global-nav"[\s\S]*?<\/nav>/, `<nav class="global-nav" aria-label="サイト内のページ"><a href="/">トップ</a>${navLinks()}</nav>`)
    .replace(/<div class="wrap header-meta">[\s\S]*?<\/div>/, "")
    .replace(/ id="[^"]*"/g, "");
  const footerHtml = tplFooter
    .replace('<div class="wrap">', `<div class="wrap">${footerLinks()}`)
    .replace('<span id="year"></span>', String(year))
    .replace('<span id="sourceList"></span>', esc(sources.join(" / ")))
    .replace(/<!--ssr:footer-links-->/, "")
    .replace(/ id="[^"]*"/g, "");
  const notice = ((tplFooter.match(/<p class="notice">([\s\S]*?)<\/p>/) || [])[1] || "").trim();
  const headStatic = (indexTpl.match(/<head>([\s\S]*?)<title>/) || [])[1] || ""; // charset・viewport・gtag
  const fontHref = (indexTpl.match(/href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/) || [])[1] || "";
  const fontLinks = fontHref
    ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preload" as="style" href="${fontHref}" onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet" href="${fontHref}"></noscript>`
    : "";
  const verify = P.googleSiteVerification ? `<meta name="google-site-verification" content="${esc(P.googleSiteVerification)}">` : "";
  const themeColor = P.themeColor || "#ffffff";

  const written = [];
  const sitemap = [];
  async function out(path, html, { lastmod, index = true } = {}) {
    const file = path.endsWith("/") ? join(DOCS, path, "index.html") : join(DOCS, path);
    const text = path.endsWith(".xml") ? html : minifyHtml(html);
    if ((await readText(file)) !== text) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, text, "utf8");
      written.push(path);
    }
    if (index) sitemap.push({ loc: abs(path), lastmod });
  }

  function sideHtml() {
    const block = (title, list) => (list.length ? `<section class="mod"><h2 class="mod-head">${esc(title)}</h2><ul class="side-links">${list.join("")}</ul></section>` : "");
    return `<aside class="side side-right">
      ${block(
        P.seriesHead || "タイトル別",
        seriesPages.map((s) => `<li><a href="/${s.slug}/">${esc(s.label)}<span class="n">${countIn((it) => (it.series || []).includes(s.id))}</span></a></li>`)
      )}
      ${block(
        "ニュースの種別",
        genres.map((g) => `<li><a href="/news/${g.slug}/">${esc(g.label)}<span class="n">${countIn((it) => (it.categories || []).includes(g.id))}</span></a></li>`)
      )}
      ${E && entities.length ? block(E.indexTitle, entities.slice(0, 12).map((e) => `<li><a href="${entityUrl(e)}">${esc(e.name)}<span class="n">${e.items.length}</span></a></li>`)) : ""}
      ${block("ほかのページ", ['<li><a href="/">トップ（注目の話題・ガチャ）</a></li>', '<li><a href="/archive/">過去のニュース</a></li>', '<li><a href="/about/">このサイトについて</a></li>'])}
      <p class="side-note">数字はこの 30 日の件数です。</p>
    </aside>`;
  }

  function page({ path, title, desc, h1, lead = "", body, crumbs = [], jsonld = [], noindex = false }) {
    const fullTitle = `${title}｜${SITE}`;
    const trail = [{ name: SITE, path: "/" }, ...crumbs];
    const bc = crumbs.length
      ? {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: trail.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: abs(c.path) })),
        }
      : null;
    return `<!doctype html>
<html lang="ja">
<head>${headStatic}
  <title>${esc(fullTitle)}</title>
  <meta name="description" content="${esc(desc)}">
  ${noindex ? '<meta name="robots" content="noindex, follow">' : ""}
  ${verify}
  <meta name="theme-color" content="${themeColor}">
  ${path === "/404.html" ? "" : `<link rel="canonical" href="${abs(path)}">`}
  <meta property="og:site_name" content="${esc(SITE)}">
  <meta property="og:title" content="${esc(fullTitle)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${abs(path)}">
  <meta property="og:image" content="${abs("/assets/og.png")}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="ja_JP">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(fullTitle)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${abs("/assets/og.png")}">
  <link rel="alternate" type="application/atom+xml" title="${esc(SITE)}" href="/feed.xml">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-48.png" type="image/png" sizes="48x48">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  ${bc ? ld(bc) : ""}
  ${jsonld.map(ld).join("")}
  ${fontLinks}
  <link rel="stylesheet" href="/assets/app.css?v=${ver.css}">
</head>
<body>
  ${headerHtml}
  <main class="wrap">
    ${
      crumbs.length
        ? `<nav class="crumbs" aria-label="パンくずリスト"><ol>${trail
            .map((c, i) => (i === trail.length - 1 ? `<li aria-current="page">${esc(c.name)}</li>` : `<li><a href="${c.path}">${esc(c.name)}</a></li>`))
            .join("")}</ol></nav>`
        : ""
    }
    <div class="layout layout-page">
      <div class="col-main">
        <div class="page-intro">
          <h1 class="sec-title page-title">${esc(h1)}</h1>
          ${lead ? `<p class="page-lead">${lead}</p>` : ""}
        </div>
        ${body}
      </div>
      ${sideHtml()}
    </div>
  </main>
  ${footerHtml}
</body>
</html>`;
  }

  // ---------- 部品: ニュースの行（app.js の makeRow と同じ形） ----------
  function thumb(it) {
    if (it.image) return `<div class="row-thumb"><img src="${esc(it.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()"></div>`;
    const ph = P.placeholder || {};
    const bg = ph.colors?.length ? ` style="background:${ph.colors[hash32(it.title) % ph.colors.length]}"` : "";
    return `<div class="row-thumb thumb-ph"${bg}>${ph.svg || esc(firstGlyph(it.title, ph.fallback || "?"))}</div>`;
  }
  function rowHtml(it) {
    const badges = [];
    if (it.isOfficial) badges.push('<span class="badge badge-official">公式</span>');
    for (const s of (it.series || []).slice(0, 1)) if (seriesLabel(s)) badges.push(`<span class="badge badge-series">${esc(seriesLabel(s))}</span>`);
    for (const c of (it.categories || []).slice(0, 1)) if (catLabel(c)) badges.push(`<span class="badge badge-cat">${esc(catLabel(c))}</span>`);
    if (it.isPR) badges.push('<span class="badge badge-pr">PR</span>');
    return `<article class="row">${thumb(it)}<div class="row-body">
      <div class="row-top">${badges.join("")}<span>${esc(it.source)} ・ <time datetime="${esc(it.publishedAt)}">${mdw(jstDay(it.publishedAt))} ${hhmm(it.publishedAt)}</time></span></div>
      <a class="row-title" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
      ${it.summary ? `<p class="row-sum">${esc(it.summary)}</p>` : ""}
    </div></article>`;
  }
  function grouped(items, tag = "h2") {
    const groups = new Map();
    for (const it of items) {
      const k = jstDay(it.publishedAt);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
    let html = "";
    for (const [day, list] of groups) html += `<section class="day"><${tag} class="day-head">${mdw(day)}</${tag}><div class="rows">${list.map(rowHtml).join("")}</div></section>`;
    return html;
  }
  function itemList(items, name) {
    return {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name,
      numberOfItems: Math.min(items.length, 20),
      itemListElement: items.slice(0, 20).map((it, i) => ({ "@type": "ListItem", position: i + 1, url: it.url, name: it.title })),
    };
  }
  const lastOf = (items) => items.reduce((a, it) => (it.publishedAt > a ? it.publishedAt : a), "") || undefined;

  // ---------- トップ ----------
  {
    const items = news?.items || [];
    const listHtml = items.length
      ? grouped(items.slice(0, 40), "h3")
      : '<div class="loading loading-feed"><span class="spinner" role="status" aria-label="読み込み中"></span><span>ニュースを読み込んでいます…</span></div>';
    let meta = "読み込み中…";
    if (news) {
      const u = jst(news.updatedAt);
      meta = `${news.total} 本のニュース ・ 今日 ${news.todayCount} 本 ・ ${(news.topics || []).length} の話題 ・ 最終更新 ${u.getUTCMonth() + 1}/${u.getUTCDate()} ${hhmm(news.updatedAt)}`;
    }
    const head = [
      verify,
      `<link rel="alternate" type="application/atom+xml" title="${esc(SITE)}" href="feed.xml">`,
      ld({ "@context": "https://schema.org", "@type": "Organization", name: SITE, url: BASE, logo: abs("/apple-touch-icon.png") }),
      items.length ? ld(itemList(items, `${SITE}の新着ニュース`)) : "",
    ].join("");
    const html = indexTpl
      .replace("<!--ssr:head-->", head)
      .replace("<!--ssr:nav-->", navLinks())
      .replace("<!--ssr:list-->", listHtml)
      .replace("<!--ssr:footer-links-->", footerLinks())
      .replace('<span id="meta">読み込み中…</span>', `<span id="meta">${esc(meta)}</span>`)
      .replace(/href="assets\/app\.css"/, `href="assets/app.css?v=${ver.css}"`)
      .replace(/src="assets\/app\.js"/, `src="assets/app.js?v=${ver.app}"`);
    await out("/", html, { lastmod: news?.updatedAt });
  }

  // ---------- タイトル（シリーズ）別 ----------
  for (const s of seriesPages) {
    const items = recent.filter((it) => (it.series || []).includes(s.id)).slice(0, LIST_MAX);
    const path = `/${s.slug}/`;
    await out(
      path,
      page({
        path,
        title: `${s.title}（最新ニュースまとめ）`,
        desc: s.desc,
        h1: s.title,
        lead: `${esc(s.desc)}新しいものから ${items.length} 件を載せています。`,
        body: items.length ? grouped(items) : '<p class="empty">いまはこのタイトルのニュースがありません。</p>',
        crumbs: [{ name: s.label, path }],
        jsonld: items.length ? [itemList(items, s.title)] : [],
        noindex: items.length < MIN_INDEXABLE,
      }),
      { lastmod: lastOf(items), index: items.length >= MIN_INDEXABLE }
    );
  }

  // ---------- ニュースの種別 ----------
  for (const g of genres) {
    const items = recent.filter((it) => (it.categories || []).includes(g.id)).slice(0, LIST_MAX);
    const path = `/news/${g.slug}/`;
    await out(
      path,
      page({
        path,
        title: `${g.title}（最新まとめ）`,
        desc: g.desc,
        h1: g.title,
        lead: `${esc(g.desc)}新しいものから ${items.length} 件を載せています。`,
        body: items.length ? grouped(items) : '<p class="empty">いまはこの種別のニュースがありません。</p>',
        crumbs: [{ name: g.label, path }],
        jsonld: items.length ? [itemList(items, g.title)] : [],
        noindex: items.length < MIN_INDEXABLE,
      }),
      { lastmod: lastOf(items), index: items.length >= MIN_INDEXABLE }
    );
  }

  // ---------- 名前別（ポケモン / モンスター） ----------
  if (E && entities.length) {
    for (const e of entities) {
      const items = e.items.slice(0, LIST_MAX);
      const path = entityUrl(e);
      const t = E.titleTpl.replace(/\{name\}/g, e.name);
      await out(
        path,
        page({
          path,
          title: t,
          desc: truncate(E.descTpl.replace(/\{name\}/g, e.name) + ` ${items.slice(0, 2).map((it) => it.title).join(" / ")}`, 120),
          h1: t,
          lead: `見出し・要約に「${esc(e.name)}」の名前が出てくるニュースを、新しいものから ${items.length} 件載せています。`,
          body: grouped(items),
          crumbs: [
            { name: E.indexTitle, path: `/${E.path}/` },
            { name: e.name, path },
          ],
          jsonld: [itemList(items, t)],
        }),
        { lastmod: lastOf(items) }
      );
    }
    await out(
      `/${E.path}/`,
      page({
        path: `/${E.path}/`,
        title: E.indexTitle,
        desc: E.indexDesc,
        h1: E.indexTitle,
        lead: `${esc(E.indexDesc)}ニュースに ${MIN_INDEXABLE} 回以上名前が出てきたものだけを載せています（直近 ${LIST_DAYS} 日）。`,
        body: `<ul class="name-list">${entities.map((e) => `<li><a href="${entityUrl(e)}">${esc(e.name)}<span class="n">${e.items.length} 件</span></a></li>`).join("")}</ul>`,
        crumbs: [{ name: E.indexTitle, path: `/${E.path}/` }],
      }),
      { lastmod: lastOf(entities.flatMap((e) => e.items.slice(0, 1))) }
    );
  }

  // ---------- 過去のニュース（日別・月別） ----------
  const months = new Map();
  for (const d of archive) {
    const k = d.day.slice(0, 7);
    if (!months.has(k)) months.set(k, []);
    months.get(k).push(d);
  }
  for (let i = 0; i < archive.length; i++) {
    const d = archive[i];
    const p = dayParts(d.day);
    const newer = archive[i - 1];
    const older = archive[i + 1];
    const path = `/archive/${dayPath(d.day)}/`;
    const pager = `<nav class="pager" aria-label="前後の日">
      ${older ? `<a href="/archive/${dayPath(older.day)}/">← ${mdw(older.day)}</a>` : "<span></span>"}
      <a href="/archive/${p.y}/${pad(p.m)}/">${p.y}年${p.m}月の一覧</a>
      ${newer ? `<a href="/archive/${dayPath(newer.day)}/">${mdw(newer.day)} →</a>` : "<span></span>"}
    </nav>`;
    await out(
      path,
      page({
        path,
        title: `${jpDay(d.day)}の${P.topic}ニュース ${d.items.length} 件`,
        desc: truncate(`${p.y}年${p.m}月${p.d}日の${P.topic}関連ニュース ${d.items.length} 件。${d.items.slice(0, 3).map((it) => it.title).join(" / ")}`, 120),
        h1: `${jpDay(d.day)}の${P.topic}ニュース`,
        lead: `この日に出た${esc(P.topic)}関連のニュース ${d.items.length} 件です。`,
        body: `<div class="rows">${d.items.map(rowHtml).join("")}</div>${pager}`,
        crumbs: [
          { name: "過去のニュース", path: "/archive/" },
          { name: `${p.y}年${p.m}月`, path: `/archive/${p.y}/${pad(p.m)}/` },
          { name: `${p.d}日`, path },
        ],
        jsonld: [itemList(d.items, `${jpDay(d.day)}の${P.topic}ニュース`)],
      }),
      { lastmod: lastOf(d.items) }
    );
  }
  for (const [k, days] of months) {
    const [y, m] = k.split("-").map(Number);
    const total = days.reduce((a, d) => a + d.items.length, 0);
    const path = `/archive/${y}/${pad(m)}/`;
    await out(
      path,
      page({
        path,
        title: `${y}年${m}月の${P.topic}ニュース一覧`,
        desc: `${y}年${m}月に出た${P.topic}関連のニュース ${total} 件を、日ごとにまとめています。`,
        h1: `${y}年${m}月の${P.topic}ニュース`,
        lead: `この月のニュース ${total} 件を日ごとに分けています。`,
        body: `<ul class="archive-days">${days
          .map(
            (d) => `<li><a class="archive-day" href="/archive/${dayPath(d.day)}/">${mdw(d.day)}<span class="n">${d.items.length} 件</span></a>
            <ul>${d.items
              .slice(0, 3)
              .map((it) => `<li>${esc(truncate(it.title, 60))}</li>`)
              .join("")}</ul></li>`
          )
          .join("")}</ul>`,
        crumbs: [
          { name: "過去のニュース", path: "/archive/" },
          { name: `${y}年${m}月`, path },
        ],
      }),
      { lastmod: lastOf(days.flatMap((d) => d.items)) }
    );
  }
  await out(
    "/archive/",
    page({
      path: "/archive/",
      title: `過去の${P.topic}ニュース`,
      desc: `これまでに集めた${P.topic}関連のニュースを、月ごと・日ごとに見られます。`,
      h1: "過去のニュース",
      lead: "これまでに集めたニュースを月ごとにまとめています。",
      body: months.size
        ? `<ul class="archive-days">${[...months]
            .map(([k, days]) => {
              const [y, m] = k.split("-").map(Number);
              return `<li><a class="archive-day" href="/archive/${y}/${pad(m)}/">${y}年${m}月<span class="n">${days.reduce((a, d) => a + d.items.length, 0)} 件</span></a></li>`;
            })
            .join("")}</ul>`
        : '<p class="empty">まだありません。</p>',
      crumbs: [{ name: "過去のニュース", path: "/archive/" }],
    }),
    { lastmod: archive[0] ? lastOf(archive[0].items) : undefined }
  );

  // ---------- このサイトについて ----------
  await out(
    "/about/",
    page({
      path: "/about/",
      title: "このサイトについて",
      desc: `${SITE}は、${P.topic}関連のニュースをあちこちの媒体から集めてまとめている、ファンによる非公式のまとめサイトです。`,
      h1: "このサイトについて",
      body: `<div class="prose">
        <h2>どんなサイト？</h2>
        <p>${esc(SITE)}は、${esc(P.topic)}関連のニュースを、ゲームメディア・ホビー媒体・プレスリリースなどから集めて、一か所で見られるようにしているまとめサイトです。30 分おきに更新しています。同じ出来事を複数の媒体が報じたものは「注目の話題」としてまとめています。</p>
        <h2>載せているもの</h2>
        <p>載せているのは、記事の見出し・要約の一部・元記事へのリンクと、元記事が設定している紹介用の画像だけです。記事の本文は転載していません。くわしい内容はリンク先の元記事でご覧ください。記事と画像の権利は、それぞれの発行元に帰属します。タイトル・種別の分け方は見出しのことばから機械的に判定しているので、まちがっていることもあります。</p>
        ${notice ? `<h2>非公式のサイトです</h2><p>${notice}</p>` : ""}
        <h2>ブラウザに保存しているもの</h2>
        <p>「あとで読む」に入れた記事や画面の状態は、お使いのブラウザ（localStorage）にだけ保存しています。サーバーには送っていません。アクセスの集計に Google アナリティクスを使っています。</p>
        ${sources.length ? `<h2>おもな収集元</h2><p>${sources.slice(0, 40).map(esc).join(" / ")}</p>` : ""}
        ${config.site?.contactUrl ? `<h2>お問い合わせ</h2><p><a href="${esc(config.site.contactUrl)}" target="_blank" rel="noopener">お問い合わせフォーム</a></p>` : ""}
      </div>`,
      crumbs: [{ name: "このサイトについて", path: "/about/" }],
    })
  );

  // ---------- 404 ----------
  await out(
    "/404.html",
    page({
      path: "/404.html",
      title: "ページが見つかりません",
      desc: "お探しのページは見つかりませんでした。",
      h1: "ページが見つかりません",
      lead: "お探しのページは、移動したか、なくなった可能性があります。",
      body: '<p><a class="more-btn" href="/">トップへ戻る</a></p>',
      noindex: true,
    }),
    { index: false }
  );

  // ---------- feed.xml（Atom） ----------
  {
    const items = (news?.items || []).slice(0, 50);
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="ja">
  <title>${esc(SITE)}</title>
  <subtitle>${esc(config.site?.tagline || "")}</subtitle>
  <link href="${BASE}" rel="alternate"/>
  <link href="${abs("/feed.xml")}" rel="self"/>
  <id>${BASE}</id>
  <updated>${news?.updatedAt || now.toISOString()}</updated>
  <author><name>${esc(SITE)}</name></author>
${items
  .map(
    (it) => `  <entry>
    <title>${esc(it.title)}</title>
    <link href="${esc(it.url)}"/>
    <id>${BASE}#${it.id}</id>
    <updated>${new Date(it.publishedAt).toISOString()}</updated>
    <summary>${esc(`${it.source}${it.summary ? ` ／ ${it.summary}` : ""}`)}</summary>
  </entry>`
  )
  .join("\n")}
</feed>
`;
    await out("/feed.xml", xml, { index: false });
  }

  // ---------- sitemap.xml ----------
  {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemap
  .map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString().replace(/\.\d{3}Z$/, "+00:00")}</lastmod>` : ""}</url>`)
  .join("\n")}
</urlset>
`;
    await out("/sitemap.xml", xml, { index: false });
  }

  log(`pages: ${sitemap.length} indexable, ${written.length} written`);
  return written;
}
