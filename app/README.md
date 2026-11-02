# Electron 版ウィジェット

画面の右端に表示する、サイドバー型のウィジェットです。Claude デスクトップのセッションを、リポジトリごとのカードにまとめ、ワークツリーごとの小見出しで分けて並べます。色は状態だけを表します。表示ルールは [docs/widget-app-plan.md](../docs/widget-app-plan.md) の「表示ルール」です。

## 動かし方
```bash
cd app
npm install
npm start
```
`npm start` は、TypeScript をビルドしてから Electron を起動します。型だけを調べるときは `npm run typecheck` です。

### 見本データで表示を確かめる
環境変数 `WIDGET_FIXTURE` に見本データのファイルを指定すると、実データの代わりにそれを表示します。対応待ちやワークツリーのセッションが今なくても、表示を確かめられます。見本データの ID は `local_sample-1` の形なので、クリックしても何も開きません。
```powershell
$env:WIDGET_FIXTURE = "$PWD\fixtures\sessions.sample.json"; npx electron .
```
PowerShell の `Start-Process -WindowStyle Hidden` で起動すると、Windows がウィンドウを非表示のままにするので、付けないでください。

## できること（今の版）
- 背景は Mica。ライト / ダークは Windows の設定に従う
- リポジトリごとのカード。見出しの右に「要対応 n」「処理中 n」のバッジ
- カードの中にワークツリーのセッションがあれば、「メイン（ブランチ名）」と各ワークツリーの小見出しで分ける
- 状態の色：対応待ちは黄の点滅、処理中は青の回るリング、待機は緑の点、停止中はグレーの空の円。対応待ちと処理中の行には左端に色の帯
- 停止中はカードの下に「停止中 n」とたたむ。開くとワークツリー名を添えて並ぶ
- 行をクリック（または Enter）すると、`claude://` リンクでそのセッションを開く
- マウスを乗せると、ワークツリーのブランチ名、対応待ちの理由、最後のターンのまとめを表示
- 右上の `>` でたたむと、リポジトリの頭文字の丸だけの細いバーになる（縁がいちばん急ぐ状態の色）。`×` で終了

## ファイル
| ファイル | 内容 |
|---|---|
| `src/main/main.ts` | ウィンドウを作り、画面の右端に置く。IPC の受け口 |
| `src/main/sessions.ts` | セッションの読み取りと、フォルダの見張り（`fs.watch`、30 秒ごとの読み直し） |
| `src/preload/preload.ts` | 画面に公開する API（`window.widget`） |
| `src/renderer/` | 画面（HTML、CSS、TypeScript）。変わったところだけを書き換える |
| `src/shared/types.ts` | メインプロセスと画面で共通の型 |
| `scripts/copy-static.mjs` | HTML と CSS を `dist/` にコピーする |
| `fixtures/sessions.sample.json` | 表示を確かめるための見本データ（一般的な名前だけ） |

## 測った数値
4K（3840×2160）の画面で、それぞれ 15 秒間測りました。
| 状態 | CPU（PC 全体） | メモリ |
|---|---|---|
| リング 1 つ（実データ、一覧の版） | 0.23%（1 コアの 3.75%） | 約 330MB |
| 点滅 1 つとリング 2 つ（見本データ、カードの版） | 0.13%（1 コアの 2.08%） | 約 336MB |

## 使っている版
Electron 44.9.0、TypeScript 7.0.2、@types/node 24.19.2（Electron 44 の Node 24 に合わせる）。どれも、出てから 2 週間以上たった版を選んでいます。
