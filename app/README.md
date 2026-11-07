# Electron 版ウィジェット

画面の右端に表示する、サイドバー型のウィジェットです。Claude デスクトップのセッションを、リポジトリごとの見出しの下に、ワークツリーごとのカードで並べます。使い終わったセッションは Bantus の中だけでアーカイブして隠します。色は状態だけを表します。表示ルールは [docs/design/widget-app-plan.md](../docs/design/widget-app-plan.md) の「表示ルール」です。

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

### ワークツリーで動かす
機能の追加はワークツリー（`.claude/worktrees/<名前>`）で進めます。ワークツリーには `app/node_modules` がないので、一番上で `npm run setup` を実行します。
```bash
npm run setup   # ワークツリーでは、main のチェックアウトの app/node_modules へのジャンクションを作る
npm start       # いつものウィジェットと並べて起動する
```
- `npm run setup`（`scripts/setup.mjs`）は、main のチェックアウトでは今までどおり `npm install` を実行し、ワークツリーでは main の `app/node_modules` へのジャンクション（管理者の権限はいらない）を作る。main の場所は `git rev-parse --git-common-dir` から求める。`app/node_modules` がもうあれば何もしない。main で先に `npm run setup` しておく
- 依存（`package.json`）を変える作業では、ジャンクションを外して（`cmd /c rmdir app\node_modules`。ジャンクションだけが消え、main の中身は残る。PowerShell の `Remove-Item` は先の中身まで消すことがあるので使わない）から `cd app` で `npm install` する
- アプリのフォルダから上へたどって最初の `.git` がファイルなら、ワークツリー版として動く（`src/main/worktree.ts`）。インストール版（`app.isPackaged`）では調べない
- ワークツリー版は、データフォルダを `%APPDATA%\Bantus-wt-<ワークツリー名>`（見本データならさらに `-debug`）に分ける。二重起動の検査も別になるので、いつものウィジェットが動いていても起動できる
- 初めて起動したときは、いつもの設定（`settings.json`）を写し、端（`edge`）を反対側にする（重ならないように）。あとは別の設定として変えられる。やり直すときは、そのフォルダを消す
- トレイのツールチップと設定ウィンドウのタイトルにワークツリー名を出す。タスクバーと知らせも、AppUserModelId を変えていつものものと分ける
- ショートカット（`Ctrl+Alt+N`）はいつものウィジェットが持っているので、ワークツリー版では登録しない（コンソールに一言出す）

### main に入ったコードへ自動で切り替える
main のチェックアウトから `npm start` で起動したウィジェットは、main に新しいコミットが入ると（ワークツリーのブランチをマージしたときなど）、自分で新しいコードに切り替わります。インストール版、ワークツリー版、見本データでは切り替えません。
- `.git` の `HEAD` と、ブランチ（`refs/heads/`、`packed-refs`）を見張る。見張りが取りこぼしても 1 分ごとに確かめる。先頭のコミットが変わったら 3 秒待ち（続けて変わったら 1 回にまとめる）、前のコミットと比べて変わったファイル（`git diff --name-only`）で決める（`src/main/update-plan.ts`）
  | 変わったもの | すること |
  |---|---|
  | `app/` の外、`app/test/`、`app/fixtures/`、`app/scripts/`（`copy-static.mjs` 以外）、`electron-builder.yml`、`*.md` だけ | 何もしない |
  | `app/src/renderer/`、`app/scripts/copy-static.mjs` | 裏で `npm run build` してから、ウィンドウを読み込み直す |
  | そのほかの `app/` のファイル（`src/main/`、`src/preload/`、`src/shared/`、`package.json`、`tsconfig.*.json`、`assets/` など） | 裏で `npm run build` してから、起動し直す |
  | `app/package-lock.json` | 自動では入れ直さず、「`npm run setup` が必要」と知らせる |
- ビルドに失敗したら今の版のまま動き続け、トレイのツールチップと Windows の通知で伝える（`npm start` では通知が出ないことがある）。同じコミットでは試し直さない。次のコミットが入れば、もう一度ビルドする
- 起動し直すと、新しいウィジェットは `npm start` のターミナルから離れて動く（ターミナルの `npm start` は終わる）。ログを見たいときは、終了してから `npm start` し直す
- 読み込み直すと、未確認の帯など画面が覚えていたことは消える。git は読むだけで、リポジトリを書き換えない（`src/main/self-update.ts`）

### exe とインストーラーを作る
```bash
npm run dist       # インストーラー（NSIS）と zip
npm run dist:dir   # 展開したフォルダだけ（試すとき。速い）
```
どちらも `dist/` を消してビルドし直してから、[electron-builder](https://www.electron.build/) で包みます。設定は `electron-builder.yml`、計画は [docs/design/packaging-plan.md](../docs/design/packaging-plan.md) です。リポジトリの一番上からでも同じ名前で動きます。
| できるもの（`release/` の下。git には入らない） | 中身 |
|---|---|
| `Bantus-Setup-<版>.exe` | インストーラー。ユーザーごと（`%LOCALAPPDATA%\Programs\Bantus`）に入り、管理者の権限はいらない。インストール先を変えられ、スタートメニューにショートカットを作る |
| `Bantus-<版>-win-x64.zip` | ポータブル版。展開して `Bantus.exe` を起動する |
| `win-unpacked/` | 展開したフォルダ（`dist:dir` でもできる） |

- 中に入るのは `dist/node/` と `dist/web/`（ソースマップを除く）と `package.json` だけ。アイコン（`assets/icon.ico`）は asar の外の `resources/assets/` に置く
- `Bantus.exe` の隣に、リポジトリの一番上の `LICENSE`（MIT。`LICENSE.txt` という名前にする）と `THIRD_PARTY_NOTICES.txt`（Lucide の ISC と Feather の MIT）を置く。インストーラー、zip、`win-unpacked/` のどれにも入る
- インストーラーは、最初に MIT の使用許諾の画面を出す（「同意する」を押して進む）
- 署名はしていないので、初めて起動すると SmartScreen の警告が出る（「詳細情報」→「実行」で進む）
- アンインストールしても、設定（`%APPDATA%\Bantus`）は残す
- インストール版と `npm start` は、同じデータフォルダを使うので同時に動かせない（二重起動の防止）。開発中に並べて動かすときは、ワークツリーで起動する（上の「ワークツリーで動かす」）か、見本データ（`npm run debug`）か `--user-data-dir=<別のフォルダ>` で起動する

### テスト
```bash
npm test
```
`node:test` で動きます（追加のパッケージなし）。`tsconfig.test.json` で `dist/test/` にビルドしてから実行します。
- `test/sessions.test.ts`：セッションの読み取り。一時フォルダに偽の `~/.claude/sessions` と `Claude-Data` を作って読ませる（本物のデータには触れない）。状態の判定、並び順、ワークツリーのまとめ方、壊れたファイルやアーカイブ済みの除外
- `test/model.test.ts`：画面に出す形への組み立て（`src/renderer/model.ts`）。リポジトリとカードの並び、アーカイブの決まり、タイムライン、バッジ、ツールチップ、「◯分前」、ショートカットで開く先、git の印
- `test/git-status.test.ts`：コミットされていない変更（`src/main/git-status.ts`）。`git status` の出力の数え方と、調べ直す時機（偽の git を使う）
- `test/settings.test.ts`：設定の値をそろえる処理（`src/shared/settings.ts`）。設定ウィンドウの位置と大きさ
- `test/update-plan.test.ts`：main に入ったコードへの切り替え方（`src/main/update-plan.ts`）。変わったファイルから、何もしない・読み込み直す・起動し直す・入れ直しが必要を決める
- `test/worktree.test.ts`：ワークツリー版の判定（`src/main/worktree.ts`）。ワークツリー名の取り出し、データフォルダと AppUserModelId の名前、最初の設定（端を反対にする）
- `test/fixtures.test.ts`：見本データの形。`all-states.json` がすべての状態・理由・分岐を含んでいるか

### 見本データで表示を確かめる（デバッグ）
実データの代わりに `fixtures/` の見本データを表示します。対応待ちやワークツリーのセッションが今なくても、すべての表示を確かめられます。
```bash
npm run debug                      # all-states（すべての状態と分岐）
npm run debug -- empty             # 見本の名前（fixtures/<名前>.json）か、ファイルのパス
npm run debug -- all-states --cycle 3   # 3 秒ごとに全セッションの状態を 1 つ進める（並べ替えのアニメーションも見られる）
node scripts/debug.mjs all-states --screenshot out.png --focus "#quit"   # その要素にフォーカスし、ツールチップを出して撮る（ツールチップは out-tooltip.png に別に撮る）
npm run screenshots                # すべての見本を dist/screenshots/<名前>.png に撮る
```
| 見本 | 中身 |
|---|---|
| `all-states.json` | 4 つの状態すべて、対応待ちの理由すべて（知らない理由と理由なしも）、対応が必要・まとめ、元のフォルダとワークツリー、同じワークツリーで 2 件が動いている、ワークツリーだけ、main だけ、アーカイブ（ワークツリー、main、起点、実線と破線、マージ済み、ワークツリーがない）、最後のターンのまとめ、ブランチ不明、フォルダなし、git の印（4 種類すべて、push していないコミットだけ）、長い名前、日本語の名前、時刻の表示すべて |
| `sessions.sample.json` | ふだんの使い方に近い少なめの例 |
| `empty.json` | セッションが 1 つもないとき |
| `many-sessions.json` | 1 枚のカードに以前のセッションが 40 件ある（一覧のスクロールと下の段を確かめる） |

- 見本データのファイルを書き換えると、すぐ表示に出る
- 見本データで起動したときは、設定とデータのフォルダを `bantus-debug` に分ける。いつものウィジェットと同時に起動でき、設定も別になる（片方を左に置くと比べやすい）
- 撮影では、アニメーションを止め、画面に収まらない分までウィンドウを伸ばしてから撮る。`--fly <セレクター>` を付けると、その要素（重なりの的など）を押して、開いた一覧を `〈保存先〉-flyout.png` に撮る
- 見本データの ID は `local_all-01` の形なので、クリックしても何も開かない。`minutesAgo` は「何分前に動きがあったか」
- 中身は環境変数で決まる：`WIDGET_FIXTURE`（見本のパス）、`WIDGET_FIXTURE_CYCLE`（巡回の秒数）、`WIDGET_SCREENSHOT`（撮って終わる。保存先）、`WIDGET_SCREENSHOT_FOCUS`（撮る前にフォーカスする要素のセレクター）

アイコンの元は `assets/icon.svg`（24px 以下は点と線を太くした `assets/icon-small.svg`）。書き換えたら `npm run icons` で `assets/icon.ico` と `assets/icon.png` を作り直す。

画面の中のアイコン（設定の歯車、フォルダ、ブランチなど）は [lucide](https://lucide.dev)（ISC License）を使う。lucide は devDependencies に入れ、使うものだけを `src/renderer/icons.ts` に書き出す。アイコンを足すときは `scripts/make-lucide-icons.mjs` の `NAMES` に名前を足して `npm run lucide-icons` を実行し、HTML では `data-icon="名前"`、TypeScript では `createIcon` / `setIcon`（`src/renderer/icon.ts`）で使う。

PowerShell の `Start-Process -WindowStyle Hidden` で起動すると、Windows がウィンドウを非表示のままにするので、付けないでください。

## できること（今の版）
- 透明なウィンドウに、テーマの背景色を設定した不透明度で塗る。背景を 0% にすると、カードとタイトルバーだけが浮かんで見え、何もない所のクリックは後ろのウィンドウに届く。ライト / ダークは Windows の設定に従う
- リポジトリごとの見出し。右に「要対応 n」「処理中 n」のバッジ。その下に、ワークツリー（元のフォルダは家のアイコンとブランチ名）ごとのカード
- 使い終わったセッションは Bantus の中だけでアーカイブして隠す。ワークツリーは最後に動いたもの以外、main は落ち着いてから設定の時間（既定 10 分）。マージ済みのワークツリーはカードごと隠し、見出しに件数を出す。処理中・対応待ち・未確認のものは隠さない。決まりは [docs/design/worktree-cards.md](../docs/design/worktree-cards.md)
- 以前のセッションがあるカードは、後ろに灰色の重なりを出す。乗せると件数の「めくれ」が外へ伸び、押すとセッションのつながり（タイムライン）が開く。行に乗せると最後のターンのまとめを出す
- カードの見出しの右に、変更・未追跡・push していないコミット・元のブランチからの遅れの件数をアイコン付きで出す。調べ方は [docs/design/git-changes.md](../docs/design/git-changes.md)
- 状態の印：対応待ちは黄の点滅で、理由ごとにアイコンを変える（許可は盾、回答はキーボード、ダイアログは窓、ほかは丸に感嘆符）。処理中は青の伸び縮みしながら回る弧、待機は緑の吹き出し、停止中はグレーの丸にマイナス。対応待ちと処理中の行には左端に色の帯
- 行の右端のトグル（乗せると出る）で、アーカイブに入れたり外したりする。手で外したものは自動では隠さない
- デスクトップで今開いているセッションの行には、ごく薄い斜めのストライプを入れる
- 行をクリック（または Enter）すると、`claude://` リンクでそのセッションを開く
- `Ctrl+Alt+N` で、未確認（左端の帯）の行を表示順に上から開く。未確認の行がなければ、今開いている行の次を開く（アーカイブしたものは選ばない）。未確認の行は Claude が前面かどうかに関係なく開く。未確認の行がなく Claude のウィンドウが前面にないときは、次へ進まずに今開いているセッションを前面に出す。キーを登録できなかったときは、コンソールにメッセージを出す
- マウスを乗せると（またはキーボードでフォーカスすると）、ワークツリーのブランチ名、対応待ちの理由、最後のターンのまとめをツールチップで表示。ツールチップは自前で描き、ウィジェットの外の画面の内側（右端に置いたら左、左端なら右）に、行の上端にそろえてフェードインする。ほかのセッションの行に重ならない
- 並びが変わると、行・カード・見出しが前の位置からすべって動き、新しく出たものはフェードインする。アニメーションを減らす設定のときと、ウィンドウが見えていないときは動かさない
- タイトルバーの右に、ピン（最前面への固定）と歯車（設定）を並べる。ピンで固定を切り替える（外すとピンが傾き、ほかのウィンドウをクリックしたときにその後ろへ回る。タスクトレイのアイコンをクリックすると前に戻る。終了はトレイの右クリックから）
- タスクバーにもボタンを出す。クリックで最小化と元に戻すを切り替える。タスクバーなどから閉じても終了せず、トレイに隠れる（トレイのクリックか「表示」で戻る）。本当に終わるのは、トレイの「終了」と Windows のシャットダウン・サインアウトのとき
- 歯車のボタンで設定ウィンドウが開く。変更はその場で反映され、保存ボタンはない。ウィンドウの位置と大きさは閉じるときに覚え、次に開くときに戻す（モニターが外れてタイトルバーが見えないときは、大きさだけ戻して真ん中に出す）。狭くすると、操作の部品は名前の下に回り、パスは名前の下で折り返す

## 設定
| カテゴリ | 項目 |
|---|---|
| 全体 | 位置：画面の端（左 / 右）、モニター。見た目：背景の不透明度（0〜100%）、カードの不透明度（0〜100%）、見出しの濃さ（0〜20%）。起動：Windows の起動時に開く |
| カードの表示 | アーカイブ：main を自動でアーカイブするまでの時間（10 分 / 30 分 / 1 時間 / しない）。並び順：プロジェクト、ワークツリー、セッション。行に出すもの：更新日時 |
| 通知 | 知らせるとき：対応待ちになったとき、完了したとき、開いているセッション。音：音を鳴らす、音の種類（試聴できる）、音量。Windows の通知：トースト通知、タスクバーの点滅 |
| 情報 | バージョン、読み取っているフォルダ、設定の保存先 |

- **背景の不透明度**：テーマの背景色（ダークなら濃い灰色）の塗り。0% で背景が消え、カードとタイトルバーだけが浮かぶ。透明なウィンドウには Mica を使えないので、100% でも Mica ではなく塗りつぶし
- **カードの不透明度**：カードとタイトルバーの塗り。0% で枠だけ。後ろが明るいと文字が読みにくくなるので、背景を 0% にするなら 80% 以上がおすすめ
- ウィンドウ全体（文字も含む）の不透明度は 100% で固定。文字は常にはっきり表示する
- **通知**：左端の帯（未確認）が新しく付いたときに、音、トースト、タスクバーの点滅で知らせる。きっかけは、対応待ちになったとき（既定で知らせる）と、完了した（処理中から待機になった）とき（Claude 本体の通知と重なるので、既定では知らせない）
  - 起動した直後の最初の読み込みでは知らせない。何件かが一度に変わっても 1 回にまとめ（対応待ちを優先）、続くときは 4 秒あける。待つ間に行を開いて帯が消えたものは知らせない
  - 「開いているセッション」を知らせないにすると、Claude のウィンドウが前面にあり、そのセッションを開いているときは知らせない（前面かどうかは、そのときだけ調べる）
  - 音は Web Audio でその場で作る（音のファイルは入れていない）。チャイム、ベル、ポンの 3 種類で、対応待ちは高め、完了は低め。設定画面の「試聴」で、対応待ちと完了の音を続けて鳴らす
  - トーストは Electron の `Notification` で、タイトルはセッション名、本文は「対応待ち（許可待ち）」や「完了」。クリックするとそのセッションを開く。通知そのものの音は消し、上の音の設定に従う。**`npm start`（インストールしていない版）では、Windows がトーストを出さないことがある**。確かめるときはインストール版を使う
  - タスクバーの点滅は、知らせるときに 3 秒ほどだけ（既定でオン）。止めたあとはオレンジのまま残さない。帯が残っていても点滅は続けない
- **未確認の帯が消えるとき**：ウィジェットで行を開いたとき、トーストをクリックしたとき、Claude 本体で開いたとき（`lastFocusedAt` が進んだとき。サイドチャットは親として扱う）。本体で見ている最中に変わったセッションには付けない
- **Windows の起動時に開く**：`app.setLoginItemSettings` で、サインインしたときに `Bantus.exe` を開くよう登録する。インストール版（zip も含む）でだけ使え、`npm start` と見本データのときは灰色で押せない（`electron.exe` が登録されてしまうため）。起動したときに Windows の登録を読んで設定に写すので、タスク マネージャーなどで変えても食い違わない

設定は `%APPDATA%\Bantus\settings.json` に保存します（リポジトリには入りません）。

項目を足すときは、`src/shared/settings.ts` の `Settings`（型）、`DEFAULT_SETTINGS`（既定値）、`SETTING_DEFS`（画面に出す定義）に足します。種類は `segmented`（切り替えボタン）、`display`（モニターの選択）、`slider` です。オン / オフの項目も `segmented` で作ります。`segmented` に `preview: 'sound'` を付けると、右に「試聴」のボタンが付きます。インストール版でだけ使える項目は `packagedOnly: true` にすると、`npm start` のときに灰色になります。新しいカテゴリは `CATEGORIES` に足すと、項目が 1 つ以上あるときだけ左の一覧に出ます。

## ファイル
| ファイル | 内容 |
|---|---|
| `src/main/main.ts` | ウィジェットと設定ウィンドウを作り、設定に合わせて位置・背景・不透明度を変える。IPC の受け口 |
| `src/main/settings-store.ts` | 設定の読み書き |
| `src/main/self-update.ts`、`src/main/update-plan.ts` | main に入ったコードへの自動の切り替え（見張り、ビルド、読み込み直しと起動し直し）と、その決め方 |
| `src/main/worktree.ts` | ワークツリーの中から起動したかの判定と、いつものウィジェットと分けるための値 |
| `src/main/sessions.ts` | セッションの読み取りと、フォルダの見張り（`fs.watch`、30 秒ごとの読み直し） |
| `src/preload/preload.ts` | 画面に公開する API（`window.widget`） |
| `src/renderer/index.html` ほか | ウィジェットの画面。変わったところだけを書き換える |
| `src/renderer/tooltip.ts` | ツールチップを出す時機（`data-tip` を持つ要素）。文字と位置をメインプロセスに渡す |
| `src/renderer/tip.html` ほか | ツールチップのウィンドウ。フォーカスを取らず、クリックは後ろへ通す |
| `src/main/tip-place.ts` | ツールチップのウィンドウを置く場所（ウィジェットの外、作業領域の中） |
| `src/renderer/flip.ts` | 並べ替えのアニメーション（FLIP。View Transitions はスクロールの枠からはみ出すので使わない） |
| `src/renderer/model.ts` | 画面に出す形への組み立て（リポジトリ、カード、アーカイブ、タイムライン、バッジ、ツールチップ）と、知らせるものの選び方。DOM を使わない |
| `src/renderer/sound.ts` | 知らせる音（Web Audio で合成する。ウィジェットと設定画面の試聴で使う） |
| `src/renderer/settings.html` ほか | 設定ウィンドウの画面。`SETTING_DEFS` から作る |
| `src/shared/types.ts` | メインプロセスと画面で共通の型 |
| `src/shared/settings.ts` | 設定項目の定義（カテゴリ、種類、既定値、値の検査） |
| `scripts/copy-static.mjs` | HTML と CSS を `dist/web/` にコピーする |
| `scripts/setup.mjs` | 一番上の `npm run setup`。main では `npm install`、ワークツリーでは main の `node_modules` へのジャンクション |
| `scripts/clean-dist.mjs` | exe に包む前に `dist/` を消す |
| `electron-builder.yml` | exe とインストーラーの設定 |
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
Electron 44.10.1、TypeScript 7.0.2、@types/node 24.19.2（Electron 44 の Node 24 に合わせる）、electron-builder 26.17.0。どれも、出てから 2 週間以上たった版を選んでいます。ただし Electron は、高の脆弱性（GHSA-jr5w-w6x2-84p9）を直すため、同じメジャーの修正版 44.10.1 に 2 週間を待たずに上げました。
