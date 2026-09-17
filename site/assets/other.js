(() => {
  const $ = (s) => document.querySelector(s);
  const PAGE_SIZE = 20;
  const SPIN_MS = 280;

  let items = [];
  let page = 1;

  function hhmm(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function spinnerNode() {
    const sp = document.createElement("span");
    sp.className = "spinner";
    sp.setAttribute("role", "status");
    sp.setAttribute("aria-label", "読み込み中");
    return sp;
  }

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
      return;
    }
    renderList();
    renderPagination();
  }

  boot();
})();
