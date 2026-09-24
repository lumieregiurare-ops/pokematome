# ポケモン速報（ポケモン関連ニュースまとめ）

ポケモン関連のニュースを集めてまとめる静的サイトです。`docs/` がサイトルートで、そのままロリポップ（FTP）に置いて公開できます。

- 掲載するのは **見出し・要約の一部・元記事へのリンク** のみ（本文の転載はしない）
- 複数の媒体が同じことを報じたものは「注目の話題」としてまとめ、媒体数を ★ で示す
- **タイトル別**（本編ゲーム / ポケモンGO / ポケカ / アニメ・映画 / ユナイト / スリープ / グッズ・コラボ）と**種別**で絞り込める
- 左右に賑やかしのモジュール: ニュースの種別・タイトル別の件数・よく出ている語・収集元（左）、**ニュースガチャ**・**きょうの1匹（全国図鑑）**・あとで読む（右）

**当サイトはファンによる非公式のまとめサイトで、株式会社ポケモン・任天堂とは関係ありません。** 「ポケットモンスター」「ポケモン」は任天堂・クリーチャーズ・ゲームフリークの登録商標です。サイト名に商標を含めていないのもこのためです。

## 使い方

```bash
npm install          # esbuild / sharp（ビルド用のみ）
npm run collect      # ニュースを収集して docs/data/news.json を更新
npm run build        # site/ を最小化して docs/ に出力
npm start            # ビルドしてローカルサーバー（http://localhost:3270）
npm run dex          # 図鑑データを作り直す（普段は不要。後述）
```

編集するのは `site/` です。**`docs/` の中身は直接編集しないでください**（次のビルドで上書きされます）。

## 収集のしくみ

| 収集元 | 内容 |
| --- | --- |
| ゲーム・ホビー媒体の RSS | 4Gamer / Game*Spark / インサイド / 電ファミニコゲーマー / AUTOMATON / GAME Watch / IGN Japan / 電撃ホビーウェブ / コミックナタリー / アニメ！アニメ！。総合フィードなので、ポケモン関連のものだけを残す |
| Google ニュースの検索フィード | `config.json` の `googleNews.queries`（9 クエリ）。**掲載件数の大半はここから来る** |

ポケモンの公式サイト・ポケモンGO 公式・ポケモンカード公式はいずれも **RSS を出していません**（2026-09 に確認、すべて 404）。一次情報も Google ニュース経由で拾う形になります。

絞り込みは mhmatome と同じ流れです。公開から 7 日を過ぎたもの、画像ギャラリーのページ（`＜画像 3 / 20＞`）、見出しが日本語でないもの、キーワードに当たらないものを落とし、見出しを正規化して重複をまとめます。

## きょうの1匹（全国図鑑）

右カラムのモジュールで、**全国図鑑 1025 匹からランダムに 1 匹**を表示します。日本語名・分類・説明文・タイプ・高さ・重さ・公式アートワークを出し、「このポケモンのニュースを探す」で一覧を絞り込めます。「伝説・幻だけ」に切り替えることもできます（伝説 71 匹 / 幻 23 匹）。

データは [PokeAPI](https://pokeapi.co/) から **1 回だけ**取って `docs/data/dex.json` に保存しています（約 390KB、1025 件）。図鑑の中身は変わらないので、収集のたびに引く必要はありません。新しい世代が追加されたときだけ流し直してください。

```bash
npm run dex              # 未取得のぶんだけ追加
node scripts/build-dex.mjs --all   # 最初から取り直す
```

`MAX_ID`（`scripts/build-dex.mjs`）が全国図鑑の番号の上限です。新作が出たら増やします。

- 画像は PokeAPI の公式アートワーク（`raw.githubusercontent.com`）を**参照**しています。リポジトリには置いていません（1025 枚で 50MB 近くになるため）
- `dex.json` はニュースの表示を邪魔しないよう、**本文を描いたあとに遅延して読み込み**ます

## 更新の間隔について

**GitHub Actions の cron は当てになりません。** 同じアカウントで実測したところ、毎時 0 分でも 30 分おきでも、10 分おきに置いても、実際に走るのは約 3 時間に 1 回、ひどいときは 9 スロット連続で 0 回でした（2026-09-16）。

そこで**更新の主役は外部トリガー**にしています。ロリポップの cron から、trend-video-watcher リポジトリにある `tools/trigger-collect.php` を実行します。このサイトを追加するときは、スクリプトの `REPOS` に `lumieregiurare-ops/pokematome` を足してください。

```bash
curl -X POST -H "Accept: application/vnd.github+json" -H "Authorization: Bearer <TOKEN>" \
  https://api.github.com/repos/lumieregiurare-ops/pokematome/dispatches \
  -d '{"event_type":"collect"}'
```

cron は配信されたとき用のフォールバックとして 10 分おきに置き、**前回の収集から 25 分たっていなければ即座に終了する**ガードを入れてあります（前回の時刻は `data/state.json` の `ranAt`）。

## 公開の設定（ロリポップ）

**Secrets**: `LOLIPOP_FTP_SERVER` / `LOLIPOP_FTP_USER` / `LOLIPOP_FTP_PASSWORD`
**Variables**: `DEPLOY_TARGET` = `lolipop`、`LOLIPOP_SERVER_DIR` = サブドメインの公開ディレクトリ（例 `./poke/`。末尾のスラッシュ必須）

サブドメインを決めたら `config.json` の `site.url` と `site/index.html` の OGP も更新してください。

## ブラウザに保存しているもの

| キー | 内容 |
| --- | --- |
| `poke:fav` | 「あとで読む」に入れた記事 |
| `poke:read` | 開いた記事（ニュースガチャで未読を優先するため） |
| `poke:state` | 選んでいるタイトル・種別・並び順などの画面の状態 |

**localStorage にだけ**保存しています。サーバーには何も送りません。

## サイト名について

サイト名は「ポケモン速報」です。変える場合は `config.json` の `site.title`、`site/index.html` の `<title>`・ロゴ・OGP・フッターを直してください。

## 検索エンジン向けのページ（SEO）

トップの画面は `app.js` が `news.json` を読んで描くので、それだけだと検索エンジンには中身が見えません。そこで、収集（`collect.mjs`）とビルド（`build.mjs`）の最後に `scripts/lib/pages.mjs` が次のものを `docs/` に書き出します（このファイルは pokematome と mhmatome で同じもの。違いは `config.json` の `pages` だけ）。

| URL | 内容 |
| --- | --- |
| `/` | `site/index.html` の `<!--ssr:…-->` に、新着 40 件・サイト内リンク・構造化データを差し込んだもの（表示後は app.js が描き直す） |
| `/game/` `/go/` `/tcg/` `/anime/` `/unite/` `/sleep/` `/goods/` | タイトル（シリーズ）別。見出し・説明・URL は `config.json` の `pages.series` |
| `/news/<slug>/` | ニュースの種別ごと。`pages.genres` |
| `/pokemon/` `/pokemon/<図鑑番号>/` | ポケモン別。図鑑（`docs/data/dex.json`）の名前が見出し・要約に 3 回以上出たものだけ（図鑑の説明文・画像は載せない） |
| `/archive/…` | 過去のニュース（月別・日別） |
| `/about/` `/404.html` `/feed.xml` `/sitemap.xml` | サイトについて・404・Atom フィード・サイトマップ |

- サブページのヘッダー・フッターは `site/index.html` から切り出して使います。見た目を変えるときは index.html を直せば、サブページにも反映されます
- 過去の記事は `data/archive/YYYY/MM/DD.json`（日本時間の日付ごと）に貯めています。`news.json` は 7 日で消えますが、こちらは消えません
- 記事が 3 件未満のページは `noindex` にして sitemap にも載せません
- 収集のワークフローは `docs/` 全体を FTP に渡します（変わったファイルだけが送られます）
- `site/.htaccess` で圧縮・キャッシュ・404 のページを設定しています。アイコンは `site/favicon.svg`（PNG は同じ絵から作ったもの）
- Google Search Console の所有権の確認に HTML タグを使う場合は、`config.json` の `pages.googleSiteVerification` に content の値を入れてください
