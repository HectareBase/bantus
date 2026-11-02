# Electron 版ウィジェット

画面の右端に表示する、サイドバー型のウィジェットです。Claude デスクトップのセッションを、リポジトリごとのカードにまとめ、ワークツリーごとの小見出しで分けて並べます。色は状態だけを表します。表示ルールは [docs/widget-app-plan.md](../docs/widget-app-plan.md) の「表示ルール」です。

## 動かし方
```bash
cd app
npm install
npm start
```
リポジトリの一番上からでも動かせます。一番上の `package.json` は、同じ名前のコマンドを `app/` に渡すだけです（`npm install` の代わりは `npm run setup`）。
```bash
npm run setup
npm start
npm run debug -- empty --cycle 3
```
`npm start` は、TypeScript をビルドしてから Electron を起動します。メインプロセスは `dist/node/`、画面は `dist/web/` に出力します（`src/shared/` を両方で使うため、出力先を分けています）。型だけを調べるときは `npm run typecheck` です。

### テスト
```bash
npm test
```
`node:test` で動きます（追加のパッケージなし）。`tsconfig.test.json` で `dist/test/` にビルドしてから実行します。
- `test/sessions.test.ts`：セッションの読み取り。一時フォルダに偽の `~/.claude/sessions` と `Claude-Data` を作って読ませる（本物のデータには触れない）。状態の判定、並び順、ワークツリーのまとめ方、壊れたファイルやアーカイブ済みの除外
- `test/model.test.ts`：画面に出す形への組み立て（`src/renderer/model.ts`）。カードと小見出しの並び、バッジ、ツールチップ、「◯分前」
- `test/fixtures.test.ts`：見本データの形。`all-states.json` がすべての状態・理由・分岐を含んでいるか

### 見本データで表示を確かめる（デバッグ）
実データの代わりに `fixtures/` の見本データを表示します。対応待ちやワークツリーのセッションが今なくても、すべての表示を確かめられます。
```bash
npm run debug                      # all-states（すべての状態と分岐）
npm run debug -- empty             # 見本の名前（fixtures/<名前>.json）か、ファイルのパス
npm run debug -- all-states --cycle 3   # 3 秒ごとに全セッションの状態を 1 つ進める（並べ替えのアニメーションも見られる）
node scripts/debug.mjs all-states --screenshot out.png --focus "#quit"   # その要素にフォーカスし、ツールチップを出して撮る
npm run screenshots                # すべての見本を dist/screenshots/<名前>.png に撮る
```
| 見本 | 中身 |
|---|---|
| `all-states.json` | 4 つの状態すべて、対応待ちの理由すべて（知らない理由と理由なしも）、対応が必要・まとめ、メインとワークツリー、同じワークツリーに複数、ワークツリーだけのカード、停止中だけのカード、ブランチ不明、フォルダなし、長い名前、日本語の名前、時刻の表示すべて |
| `sessions.sample.json` | ふだんの使い方に近い少なめの例 |
| `empty.json` | セッションが 1 つもないとき |

- 見本データのファイルを書き換えると、すぐ表示に出る
- 見本データで起動したときは、設定とデータのフォルダを `bantus-debug` に分ける。いつものウィジェットと同時に起動でき、設定も別になる（片方を左に置くと比べやすい）
- 撮影では、停止中をすべて開き、アニメーションを止め、画面に収まらない分までウィンドウを伸ばしてから撮る
- 見本データの ID は `local_all-01` の形なので、クリックしても何も開かない。`minutesAgo` は「何分前に動きがあったか」
- 中身は環境変数で決まる：`WIDGET_FIXTURE`（見本のパス）、`WIDGET_FIXTURE_CYCLE`（巡回の秒数）、`WIDGET_SCREENSHOT`（撮って終わる。保存先）、`WIDGET_SCREENSHOT_FOCUS`（撮る前にフォーカスする要素のセレクター）

アイコンの元は `assets/icon.svg`（24px 以下は点と線を太くした `assets/icon-small.svg`）。書き換えたら `npm run icons` で `assets/icon.ico` と `assets/icon.png` を作り直す。

画面の中のアイコン（設定の歯車、フォルダ、ブランチなど）は [lucide](https://lucide.dev)（ISC License）を使う。lucide は devDependencies に入れ、使うものだけを `src/renderer/icons.ts` に書き出す。アイコンを足すときは `scripts/make-lucide-icons.mjs` の `NAMES` に名前を足して `npm run lucide-icons` を実行し、HTML では `data-icon="名前"`、TypeScript では `createIcon` / `setIcon`（`src/renderer/icon.ts`）で使う。

PowerShell の `Start-Process -WindowStyle Hidden` で起動すると、Windows がウィンドウを非表示のままにするので、付けないでください。

## できること（今の版）
- 透明なウィンドウに、テーマの背景色を設定した不透明度で塗る。背景を 0% にすると、カードとタイトルバーだけが浮かんで見え、何もない所のクリックは後ろのウィンドウに届く。ライト / ダークは Windows の設定に従う
- リポジトリごとのカード。見出しの右に「要対応 n」「処理中 n」のバッジ
- カードの中にワークツリーのセッションがあれば、「メイン（ブランチ名）」と各ワークツリーの小見出しで分ける
- 状態の印：対応待ちは黄の点滅で、理由ごとにアイコンを変える（許可は盾、回答はキーボード、ダイアログは窓、ほかは丸に感嘆符）。処理中は青の伸び縮みしながら回る弧、待機は緑の吹き出し、停止中はグレーの丸にマイナス。対応待ちと処理中の行には左端に色の帯
- 停止中はカードの下に「停止中 n」とたたむ。開くとワークツリー名を添えて並ぶ
- 行をクリック（または Enter）すると、`claude://` リンクでそのセッションを開く
- マウスを乗せると（またはキーボードでフォーカスすると）、ワークツリーのブランチ名、対応待ちの理由、最後のターンのまとめをツールチップで表示。ツールチップは自前で描き、行の下（入らなければ上）にフェードインする。たたんだ表示ではウィンドウに収まらないので、OS のツールチップを使う
- 並びが変わると、行・小見出し・カードが前の位置からすべって動き、新しく出たものはフェードインする。アニメーションを減らす設定のときと、ウィンドウが見えていないときは動かさない
- 右上の `>` でたたむと、リポジトリの頭文字の丸だけの細いバーになる（縁がいちばん急ぐ状態の色）。`×` で終了
- 歯車のボタンで設定ウィンドウが開く。変更はその場で反映され、保存ボタンはない

## 設定
| カテゴリ | 項目 |
|---|---|
| 表示 | 画面の端（左 / 右）、モニター、背景の不透明度（0〜100%）、カードの不透明度（0〜100%） |
| 情報 | バージョン、読み取っているフォルダ、設定の保存先 |

- **背景の不透明度**：テーマの背景色（ダークなら濃い灰色）の塗り。0% で背景が消え、カードとタイトルバーだけが浮かぶ。透明なウィンドウには Mica を使えないので、100% でも Mica ではなく塗りつぶし
- **カードの不透明度**：カードとタイトルバーの塗り。0% で枠だけ。後ろが明るいと文字が読みにくくなるので、背景を 0% にするなら 80% 以上がおすすめ
- ウィンドウ全体（文字も含む）の不透明度は 100% で固定。文字は常にはっきり表示する

設定は `%APPDATA%\bantus\settings.json` に保存します（リポジトリには入りません）。

項目を足すときは、`src/shared/settings.ts` の `Settings`（型）、`DEFAULT_SETTINGS`（既定値）、`SETTING_DEFS`（画面に出す定義）に足します。種類は `segmented`（切り替えボタン）、`display`（モニターの選択）、`slider` です。オン / オフの項目が必要になったら、種類を足します。新しいカテゴリは `CATEGORIES` に足すと、項目が 1 つ以上あるときだけ左の一覧に出ます。

## ファイル
| ファイル | 内容 |
|---|---|
| `src/main/main.ts` | ウィジェットと設定ウィンドウを作り、設定に合わせて位置・背景・不透明度を変える。IPC の受け口 |
| `src/main/settings-store.ts` | 設定の読み書き |
| `src/main/sessions.ts` | セッションの読み取りと、フォルダの見張り（`fs.watch`、30 秒ごとの読み直し） |
| `src/preload/preload.ts` | 画面に公開する API（`window.widget`） |
| `src/renderer/index.html` ほか | ウィジェットの画面。変わったところだけを書き換える |
| `src/renderer/tooltip.ts` | ツールチップ（`data-tip` を持つ要素。`popover="hint"` と CSS anchor positioning） |
| `src/renderer/flip.ts` | 並べ替えのアニメーション（FLIP。View Transitions はスクロールの枠からはみ出すので使わない） |
| `src/renderer/model.ts` | 画面に出す形への組み立て（カード、小見出し、バッジ、ツールチップ）。DOM を使わない |
| `src/renderer/settings.html` ほか | 設定ウィンドウの画面。`SETTING_DEFS` から作る |
| `src/shared/types.ts` | メインプロセスと画面で共通の型 |
| `src/shared/settings.ts` | 設定項目の定義（カテゴリ、種類、既定値、値の検査） |
| `scripts/copy-static.mjs` | HTML と CSS を `dist/web/` にコピーする |
| `fixtures/*.json` | 表示を確かめるための見本データ（一般的な名前だけ） |
| `scripts/debug.mjs`、`scripts/screenshots.mjs` | 見本データでの起動と撮影 |
| `test/` | テスト（`npm test`） |

## 測った数値
4K（3840×2160）の画面で、それぞれ 15 秒間測りました。
| 状態 | CPU（PC 全体） | メモリ |
|---|---|---|
| リング 1 つ（実データ、一覧の版） | 0.23%（1 コアの 3.75%） | 約 330MB |
| 点滅 1 つとリング 2 つ（見本データ、カードの版） | 0.13%（1 コアの 2.08%） | 約 336MB |

## 使っている版
Electron 44.9.0、TypeScript 7.0.2、@types/node 24.19.2（Electron 44 の Node 24 に合わせる）。どれも、出てから 2 週間以上たった版を選んでいます。
