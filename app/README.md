# Electron 版ウィジェット

画面の右端に表示する、サイドバー型のウィジェットです。Claude デスクトップのセッションを、状態ごと（対応待ち → 処理中 → 待機 → 停止中）に並べます。

## 動かし方
```bash
cd app
npm install
npm start
```
`npm start` は、TypeScript をビルドしてから Electron を起動します。型だけを調べるときは `npm run typecheck` です。

## できること（今の版）
- 背景は Mica。ライト / ダークは Windows の設定に従う
- 処理中は回るリング、対応待ちはゆっくり点滅する点、待機は中が空の円
- 行をクリック（または Enter）すると、`claude://` リンクでそのセッションを開く
- マウスを乗せると、対応待ちの理由と最後のターンのまとめを表示
- 右上の `>` でたたむと、状態ごとの件数だけの細いバーになる。`×` で終了
- 左端の色帯はフォルダごとの色（今はフォルダ名から自動で決める）

## ファイル
| ファイル | 内容 |
|---|---|
| `src/main/main.ts` | ウィンドウを作り、画面の右端に置く。IPC の受け口 |
| `src/main/sessions.ts` | セッションの読み取りと、フォルダの見張り（`fs.watch`、30 秒ごとの読み直し） |
| `src/preload/preload.ts` | 画面に公開する API（`window.widget`） |
| `src/renderer/` | 画面（HTML、CSS、TypeScript）。変わったところだけを書き換える |
| `src/shared/types.ts` | メインプロセスと画面で共通の型 |
| `scripts/copy-static.mjs` | HTML と CSS を `dist/` にコピーする |

## 測った数値
4K（3840×2160）の画面で、処理中のリングが 1 つ回っている状態で 15 秒間測りました。
- CPU：PC 全体の 0.23%（1 コアの 3.75%）
- メモリ：4 プロセスの合計で約 330MB

## 使っている版
Electron 44.9.0、TypeScript 7.0.2、@types/node 24.19.2（Electron 44 の Node 24 に合わせる）。どれも、出てから 2 週間以上たった版を選んでいます。
