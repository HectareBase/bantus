# 常駐の補助プログラム（C の exe と、使えないときの PowerShell）

Windows の API（前面のウィンドウ、ウィンドウの一覧とアイコン、`WM_COPYDATA`、アプリバー）を呼ぶために、補助プログラムを 2 つ常駐させています（`src/main/foreground.ts` 用と `src/main/appbar.ts` 用）。どちらも C で書いた 1 つの exe（`bantus-helper.exe`）を、引数を変えて起動します。exe を使えないときだけ、同じ命令に答える PowerShell のスクリプトに切り替えます。

以前は PowerShell だけでした。PowerShell は 2 つで約 140MB のメモリを使い、起動に 1〜2 秒かかります。また、`-EncodedCommand` と `Add-Type` は、監視の厳しいセキュリティソフトで警告の対象になりやすく、制限言語モード（AppLocker/WDAC）では `Add-Type` が使えません。

## 作り
- ソースは `app/native/bantus-helper.c` の 1 ファイル。引数なしで起動すると `foreground.ts` の命令（`fg`、`raise`、`open`、`wins`、`front`、`icon`）、`appbar` を付けると `appbar.ts` の命令（`new`、`query`、`set`、`remove`）に答える
- 命令と答えの形は、`foreground.ts` と `appbar.ts` にある PowerShell のスクリプトとまったく同じ。**命令を足したり変えたりするときは、C と PowerShell の両方を直す**
- 起動と切り替えは `src/main/helper-line.ts`。exe は、インストール版では `resources/bantus-helper.exe`、開発中は `app/native/build/bantus-helper.exe` を探す
- 次のときは PowerShell に切り替え、答えていない命令を送り直す。一度切り替えたら、そのあとは両方とも PowerShell を使う
  - exe がない（MSVC のない PC で開発しているとき）
  - 起動できない（`spawn` がその場で例外を投げることもある）、一度も答えずに落ちた（セキュリティソフトや AppLocker に止められたとき）
- 環境変数 `BANTUS_HELPER=powershell` を付けて起動すると、初めから PowerShell を使う（比べるとき用）
- 標準入力が閉じたら（Bantus が終わった、落ちた）、アプリバーの登録を外してから終わる。強制終了でも帯が外れることを確かめた
- コンソールのないプログラム（`/SUBSYSTEM:WINDOWS`）にした。コンソールのプログラムだと、隠していても `conhost.exe` が 1 つ付いてくる（PowerShell には付いている）。ウィンドウのあるプログラムとして起動すると「起動中」のマウスの形が出るので、起動してすぐメッセージを 1 回受け取って消す
- PNG は自前で書く（zlib の無圧縮ブロック）。GDI+ や WIC を読み込まないため。32px のアイコンで 5〜6KB ほど
- DPI は Per-Monitor v2。座標はどれも物理ピクセル

## ビルドと同梱
- `npm run build`（`npm start` も）は、最後に `scripts/build-native.mjs --if-available` を呼ぶ。Visual Studio の C++ のビルドツール（MSVC）を `vswhere` で探してビルドし、なければ飛ばす（アプリは PowerShell で動く）。ソースより exe が新しければビルドしない
- `npm run build:native` は、MSVC がなければ失敗する。`npm run dist` と `npm run dist:dir` はこちらを通すので、exe のないインストーラーはできない
- 動いている exe は上書きできないので、別名でビルドしてから入れ替える。古いほうは `.old<n>.exe` にして、次のビルドで消す
- C のランタイムは exe に入れる（`/MT`）ので、再頒布パッケージは要らない。大きさは 190KB ほど。警告はエラーにする（`/W4 /WX`）
- electron-builder の `extraResources` で `resources/` に置く（asar の中からは起動できない）
- 署名はしない（Bantus.exe も署名していない。[packaging-plan.md](packaging-plan.md)）。署名のない exe はセキュリティソフトに怪しまれやすい。止められたら PowerShell に切り替わる

## 測った値
同じ PC で、同じ命令を両方に送って比べた（置き換えたときの記録）。答えは 43 種の命令（不正な引数を含む）とアプリバーの `query` で 1 文字も違わず、アイコンは画素まで同じだった。

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

## これから
- PowerShell の版を外すかどうか。外すと二重の実装はなくなるが、MSVC のない PC で開発するときと、exe が止められた環境で、ウィンドウまわりの機能が使えなくなる
- 署名。利用者が増えたら、Bantus.exe と一緒に考える
