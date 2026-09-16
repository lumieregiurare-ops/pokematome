// PokeAPI から日本語の図鑑データを 1 回だけ取ってきて docs/data/dex.json に保存する。
// 図鑑の中身は変わらないので、収集のたびに引く必要はない。追加が出たときだけ流し直す。
//   node scripts/build-dex.mjs          … 未取得のぶんだけ追加する
//   node scripts/build-dex.mjs --all    … 最初から取り直す
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { readJson, log } from "./lib/util.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "data", "dex.json");
const MAX_ID = 1025; // 全国図鑑の番号（2026-09 時点）
const CONCURRENCY = 4;
const ART = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork";

const force = process.argv.includes("--all");
const existing = force ? { entries: [] } : await readJson(OUT, { entries: [] });
const have = new Set((existing.entries || []).map((e) => e.id));

async function getJson(url) {
  const r = await fetch(url, { headers: { "user-agent": "pokematome (personal site)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

// タイプ名の日本語は種類が少ないので先にまとめて引く
const typeJa = new Map();
for (const t of (await getJson("https://pokeapi.co/api/v2/type?limit=30")).results) {
  const d = await getJson(t.url);
  const ja = (d.names || []).find((n) => n.language.name === "ja")?.name;
  if (ja) typeJa.set(t.name, ja);
}
log(`タイプ ${typeJa.size} 種`);

const targets = [];
for (let id = 1; id <= MAX_ID; id++) if (!have.has(id)) targets.push(id);
log(`取得対象 ${targets.length} 件（保存済み ${have.size} 件）`);

const out = [...(existing.entries || [])];
let done = 0;
let failed = 0;

async function fetchOne(id) {
  try {
    const [sp, pk] = await Promise.all([
      getJson(`https://pokeapi.co/api/v2/pokemon-species/${id}/`),
      getJson(`https://pokeapi.co/api/v2/pokemon/${id}/`),
    ]);
    const name = (sp.names || []).find((n) => n.language.name === "ja")?.name;
    if (!name) return; // 日本語名が無いものは載せない
    const genus = (sp.genera || []).find((g) => g.language.name === "ja")?.genus || "";
    // 説明文は世代ごとにあるので、いちばん新しいものを使う。改行や制御文字を落とす
    const flavors = (sp.flavor_text_entries || []).filter((f) => f.language.name === "ja");
    // 説明文はカードに 2 行で出すだけなので、長いものは切って dex.json を軽くする
    const flavorFull = (flavors[flavors.length - 1]?.flavor_text || "").replace(/[\n\f\r]/g, "").replace(/\s+/g, " ").trim();
    const flavor = flavorFull.length > 90 ? `${flavorFull.slice(0, 89)}…` : flavorFull;
    out.push({
      id,
      name,
      genus,
      flavor,
      types: pk.types.map((t) => typeJa.get(t.type.name) || t.type.name),
      height: pk.height / 10,
      weight: pk.weight / 10,
      image: `${ART}/${id}.png`,
      isLegendary: !!sp.is_legendary,
      isMythical: !!sp.is_mythical,
    });
  } catch (e) {
    failed++;
    log(`#${id} 失敗: ${e.message}`);
  } finally {
    done++;
    if (done % 100 === 0) log(`${done}/${targets.length}`);
  }
}

const queue = [...targets];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await fetchOne(queue.shift());
  })
);

out.sort((a, b) => a.id - b.id);
// 1000 件を超えるので、読みやすさより軽さを優先して詰めて書く（整形すると 100KB 以上増える）
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), count: out.length, entries: out }), "utf8");
log(`dex.json に ${out.length} 件を保存（失敗 ${failed} 件）`);
