# 常駐の PowerShell を C の小さなプログラムに置き換える（試作）

Windows の API を呼ぶために常駐させている 2 つの PowerShell（`src/main/foreground.ts` と `src/main/appbar.ts`）を、C で書いた 1 つの exe（`bantus-helper.exe`）に置き換える試作です。今は試しの段階で、既定は PowerShell のままです。

## 作り
- ソースは `app/native/bantus-helper.c` の 1 ファイル。引数なしで起動すると `foreground.ts` の命令（`fg`、`raise`、`open`、`wins`、`front`、`icon`）、`appbar` を付けると `appbar.ts` の命令（`new`、`query`、`set`、`remove`）に答える
- 命令と答えの形は PowerShell のスクリプトとまったく同じ。TypeScript 側は起動するもの（`src/main/native-helper.ts` の `helperCommand`）が変わるだけ。片方を直すときは両方を直す
- 標準入力が閉じたら（Bantus が終わった、落ちた）、アプリバーの登録を外してから終わる。強制終了でも帯が外れることを確かめた
- コンソールのないプログラム（`/SUBSYSTEM:WINDOWS`）にした。コンソールのプログラムだと、隠していても `conhost.exe` が 1 つ付いてくる（PowerShell には付いている）。ウィンドウのあるプログラムとして起動すると「起動中」のマウスの形が出るので、起動してすぐメッセージを 1 回受け取って消す
- PNG は自前で書く（zlib の無圧縮ブロック）。GDI+ や WIC を読み込まないため。32px のアイコンで 5〜6KB ほど
- DPI は Per-Monitor v2。座標はどれも物理ピクセル

## ビルドと切り替え
- `npm run build:native`（一番上でも `app/` でも）。Visual Studio の C++ のビルドツール（MSVC）を `vswhere` で探し、`app/native/build/bantus-helper.exe` に置く（git には入れない）。C のランタイムは exe に入れる（`/MT`）ので、再頒布パッケージは要らない。大きさは 190KB ほど
- 環境変数 `BANTUS_HELPER=native` を付けて起動すると exe を使う。exe がなければ PowerShell に戻る
- `npm run build` には入れていない。MSVC のない PC でもビルドできるようにするため

## 測った値
同じ PC で、同じ命令を両方に送って比べた。答えは 43 種の命令（不正な引数を含む）とアプリバーの `query` で 1 文字も違わず、アイコンは画素まで同じだった。

| | PowerShell | exe |
|---|---|---|
| プロセス専用のメモリ（起動直後） | 68〜69MB | 1.2MB |
| プロセス専用のメモリ（`icon` を使ったあと） | 103〜108MB | 1.2〜1.3MB |
| 作業セット（`icon` を使ったあと） | 121〜127MB | 7〜8MB |
| 付いてくる `conhost.exe` | 1 つ（専用 1.2MB、作業セット 7.3MB） | なし |
| アプリの中で動いているとき（プロセス専用、2 つの合計） | 72MB + 65MB | 1.3MB + 1.2MB |
| 起動から最初の答えまで | 1.4〜2.1 秒 | 23〜47ms |
| `fg` の 1 回（中央値） | 5.7〜7.7ms | 0.08〜0.11ms |
| `wins` の 1 回（中央値、ウィンドウ 2 つ） | 0.64〜0.68ms | 0.20〜0.24ms |
| `icon` の 1 回（中央値、大 / 小） | 9〜16ms / 8〜17ms | 0.7〜5ms / 0.5〜0.6ms |
| `wins` を 3 秒ごとに 90 秒（CPU 時間、4 回） | 32、47、63、78ms | 16、31、31、47ms |
| 続けて 500 回送ったときの 1 回の CPU 時間 | `wins` 0.53ms、`fg` 5.4ms | `wins` 0.19ms、`fg` 0.00ms |

- 90 秒の CPU 時間は、Windows の計時の刻み（15.6ms）の数個分しかなく、差ははっきりしない。続けて送った値のほうが比べやすい
- `wins` は PowerShell でも中身は C#（`Add-Type`）なので、差は 3 倍ほどにとどまる。`fg` は PowerShell が `Get-Process` を通すので差が大きい

## 本採用にするなら残る作業
- インストーラーへの同梱：electron-builder の `extraResources` で exe を入れ、`helperCommand` の場所をインストール版では `process.resourcesPath` から引く
- ビルドの手順：`npm run dist` の前に `build:native` を通す。MSVC のない PC のために、ビルドした exe をリポジトリに置くか、CI でビルドするかを決める
- 署名：署名のない exe はセキュリティソフトに怪しまれやすい（Electron 本体の exe も署名していないので、今と大きくは変わらない）
- 既定の切り替え：exe を既定にし、起動できなかったら PowerShell に戻す
- 二重の実装：命令を足すたびに PowerShell と C の両方を直すのは重い。exe を既定にしたら、PowerShell の版は外す
