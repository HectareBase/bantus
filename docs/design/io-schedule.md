# 動かすコマンドと読むファイル、その周期

ウィジェット（`app/`）が、**いつ、何を、どのくらいの頻度で**読んだり動かしたりするかをまとめます。読む項目の意味と使い道は [data-usage.md](data-usage.md)、ファイルの形式は [data-sources.md](../research/data-sources.md) にあります。ここでは周期ときっかけを中心に書きます。

数値はコードの定数から取りました。定数を変えたら、ここもあわせて直してください。

## 全体の流れ
周期の中心は、セッション一覧の読み直し（`sendSessions`）です。git の確認、取得の対象、HTML ビューアは、この読み直しに合わせて動きます。

```
ファイルの変化（fs.watch）──250ms でまとめる──┐
30 秒ごとのタイマー ─────────────────────────┼─▶ readSessions ─▶ gitStatus.apply ─▶ 画面へ送る
バックグラウンドの作業・タスクリストの変化 ───┘                    │
                                                                  └─▶ 古くなったフォルダだけ git を動かす（1 つずつ）
```

## 常に動いているタイマーと見張り
| 何を | 周期・きっかけ | 止まるとき | コード |
|---|---|---|---|
| セッション一覧の読み直し | `fs.watch` の変化を 250ms 待ってまとめる。取りこぼしに備えて 30 秒ごと | 終了まで動く | `src/main/sessions.ts`（`watchSessions`） |
| 取得（`git fetch`）の待ち行列の確認 | 15 秒ごとに時刻の来たリポジトリを探す（実際の取得の間隔は下の「git」） | 設定で取得がオフなら何もしない | `src/main/main.ts`（`FETCH_TICK_MS`）、`src/main/git-fetch.ts` |
| PC の CPU とメモリ | 3 秒ごと（動き出して最初は 300ms 後）。`os.cpus()`、`os.totalmem()`、`os.freemem()` でファイルは読まない | ウィジェットが見えていないとき、設定で出さないとき | `src/main/system-usage.ts` |
| ウィンドウの切り替えの一覧 | 3 秒ごと（動き出して最初は 100ms 後）。常駐の PowerShell に `wins` を聞く。アイコンはウィンドウごとに 1 回だけ `icon` で取る | ウィジェットが見えていないとき、設定で出さないとき | `src/main/window-switcher.ts` |
| カーソルの位置（めくれを出すため） | 近いとき・めくれを出しているときは 30ms、遠いときは 250ms | ウィジェットが見えていないとき | `src/main/flyout.ts`、`src/main/tip-place.ts` |
| 「◯分前」の描き直しと自動アーカイブ | 画面の中で 60 秒ごと | 終了まで動く | `src/renderer/renderer.ts` |
| 取得の結果（設定画面） | 設定画面を開いている間、30 秒ごとにメインプロセスに聞く | 設定画面を閉じたとき | `src/renderer/settings.ts` |
| main に入ったコードへの自動の切り替え | `.git` の `HEAD`、`packed-refs`、`refs/heads` を `fs.watch` で見張り、3 秒待ってまとめる。取りこぼしに備えて 60 秒ごと | `npm start` を main のチェックアウトから動かしたときだけ（インストール版、ワークツリー、見本データでは動かない） | `src/main/self-update.ts` |

## 見張るフォルダとファイル（fs.watch）
| 対象 | 範囲 | 変わったら | コード |
|---|---|---|---|
| `%USERPROFILE%\.claude\sessions` | 下のフォルダも含む | 一覧の読み直し（250ms でまとめる） | `src/main/sessions.ts` |
| `%LOCALAPPDATA%\Claude-Data\claude_*\claude-code-sessions` | 下のフォルダも含む | 一覧の読み直し（250ms でまとめる） | `src/main/sessions.ts` |
| 会話の記録 `<cliSessionId>.jsonl`（処理中のセッション） | そのファイルだけ | 150ms 待ってタスクリストを読み直す。手順の数か状態が変わったときだけ一覧を読み直す | `src/main/plan-progress.ts` |
| 会話の記録 `<cliSessionId>.jsonl`（バックグラウンドの作業が 1 つ以上ある待機中のセッション） | そのファイルだけ | 一覧の読み直し | `src/main/background-work.ts` |
| HTML ビューアに出しているファイルの入ったフォルダ | そのフォルダだけ | 300ms 待って読み込み直す（設定でオンにしたときだけ） | `src/main/viewer.ts` |
| アプリのリポジトリの `.git` | 上の「自動の切り替え」を参照 | ビルドして読み込み直すか起動し直す | `src/main/self-update.ts` |

会話の記録のフォルダ（`~/.claude/projects`）全体は見張りません。処理中は書き込みが多く、読み直しが増えすぎるためです。

## 一覧の読み直し 1 回で読むもの
`readSessions` が読むものです。読み直しは上のとおり、変化のたびと 30 秒ごとに起きます。

| 読むもの | 毎回読むか | 使い回し | コード |
|---|---|---|---|
| `~/.claude/sessions/<pid>.json` | 毎回すべて読む。`pid` のプロセスがあるかも毎回確かめる | しない（小さく、状態を短い間に書き換えるため） | `src/main/sessions.ts`（`readRunning`） |
| `Claude-Data\...\local_*.json` のフォルダの一覧 | 毎回 | しない | `src/main/sessions.ts` |
| `local_*.json` | 毎回 `stat` する。中身は更新時刻、変更時刻、大きさ、ファイルの番号のどれかが変わったときだけ読む | 解釈した中身を、データフォルダごとに覚える | `src/main/sessions.ts`（`createJsonCache`） |
| アーカイブ済みのセッションから作った値（通し番号用） | `local_*.json` の中身が変わったときだけ作り直す | 中身ごとに覚える | `src/main/sessions.ts` |
| 作業フォルダの `.git`（ファイルかフォルダか、`gitdir:` の先、`commondir`） | ワークツリーを探すとき、`gitAnchors` のないセッションのリポジトリを探すとき | 60 秒まで使い回す。元のリポジトリの一番上まで上がったら読まない | `src/main/sessions.ts`（`findWorktreeRoot`、`findGitAnchor`） |
| `.git/HEAD`、`.git/worktrees/<名前>/HEAD` | 毎回（1 回の読み直しの中では同じものを 1 度だけ） | しない（ブランチの切り替えをすぐ出すため） | `src/main/sessions.ts`（`readHeadBranch`） |
| 会話の記録の場所 `~/.claude/projects/<フォルダ>/<cliSessionId>.jsonl` | 作業フォルダから決めた場所にあるかを確かめる。なければ `projects` の下のフォルダの一覧から探す | 見つからなかったセッションは 60 秒探し直さない | `src/main/context-usage.ts`（`createTranscriptLocator`） |
| 会話の記録の末尾（コンテキストの使用量） | アーカイブしていないセッションで、毎回 `stat` する。大きさか更新時刻が変わったときだけ末尾を読む（64KB、見つからなければ 4MB まで） | 結果を覚える | `src/main/context-usage.ts` |
| 会話の記録の増えた分（バックグラウンドの作業） | 動いていて待機中のセッションだけ。前回の位置から増えた分を読む | 読んだ位置と数を覚える。処理中と対応待ちの間は止める | `src/main/background-work.ts`、`src/main/jsonl-tail.ts` |
| 会話の記録の増えた分（タスクリスト） | 動いていて処理中のセッションだけ。前回の位置から増えた分を読む | 読んだ位置と状態を覚える。処理中でなくなったら止める | `src/main/plan-progress.ts`、`src/main/jsonl-tail.ts` |

会話の記録を初めて読むときなど、増えた分が 256KB を超えるときは、メインプロセスを止めないよう 1MB ずつ 15ms あけて読みます。

## git
git はどれも作業フォルダに書き込みません（取得だけは `refs/remotes` と取ってきたオブジェクトを書きます。[git-fetch.md](git-fetch.md)）。`git status` などは一度に 1 つずつ、待ち行列で動かします。1 回起動するのに 40〜50ms ほどかかります。

### 作業フォルダの確認（`src/main/git-status.ts`）
一覧の読み直しのたびに、次のフォルダだけを待ち行列に入れます（[git-changes.md](git-changes.md) の「いつ調べるか」）。

| きっかけ | 周期 |
|---|---|
| まだ調べていない | すぐ |
| 処理中か対応待ちのセッションがある | 前の結果から 30 秒 |
| 待機中と停止中のセッションだけ | 前の結果から 5 分 |
| 処理中のセッションが処理中でなくなった（ターンの終わり） | すぐ |
| 取得のあと（そのリポジトリの作業フォルダ）、設定の取得や未追跡の数え方を変えたとき（すべて） | 次の読み直しで |

1 つのフォルダで動かすコマンドは次のとおりです。

| コマンド | いつ | 使い回し |
|---|---|---|
| `git --no-optional-locks -C <フォルダ> status --porcelain=v2 --branch`（設定で未追跡を数えないときは `--untracked-files=no`） | 調べるたびに 1 回 | しない |
| `for-each-ref --format=%(refname:lstrip=2) %(ahead-behind:HEAD) refs/heads/`、`rev-list --no-walk --ignore-missing <コミット>...`、`for-each-ref --no-contains=<コミット>... refs/heads/`、必要なら `rev-list --first-parent`、`rev-parse`、`rev-list --count` | ワークツリーだけ。分岐元を割り出すとき | HEAD か作業フォルダのブランチの reflog が変わったとき、選んだ分岐元が消えたとき、30 分たったときだけ調べ直す（`src/main/base-branch.ts`） |
| `rev-list --left-right --count <分岐元>...HEAD`、マージ済みを調べるときは `rev-list --first-parent --reverse HEAD..<ref>` と `rev-parse <コミット>^1 HEAD` | ワークツリーだけ。元のブランチとの差を数えるとき | HEAD と、比べる ref（分岐元、リモートの写し、main）の先頭のコミットが同じなら使い回す（`createBranchReader`） |

使い回すかどうかを決めるために、git を動かさずに `.git` のファイル（`HEAD`、`refs/heads/*`、`packed-refs`、`logs/refs/heads/*` の頭、`reftable` があるか）を読みます。

### リモートの取得（`src/main/git-fetch.ts`）
設定の「定期的に取得する」がオンのときだけ動きます（既定はオフ）。

| コマンド | いつ |
|---|---|
| `git --no-optional-locks -C <フォルダ> config --get branch.<ブランチ>.remote` | 取得の直前に毎回 |
| `git -C <フォルダ> -c credential.interactive=never fetch --no-auto-gc --no-auto-maintenance --no-write-fetch-head --quiet <リモート>` | 起動から（またはオンにしてから）60 秒後に初回。そのあとはリポジトリごとに、設定で選んだ間隔（5 / 10 / 30 分）。ロックで失敗したときは 60 秒後に 1 度だけやり直す。1 回 60 秒で打ち切る |
| 同じ取得 | 設定画面の「今すぐ取得」を押したとき |

### 自動の切り替え（`src/main/self-update.ts`）
`npm start` を main のチェックアウトから動かしたときだけです。

| コマンド | いつ |
|---|---|
| `git rev-parse --path-format=absolute --show-toplevel --git-dir --git-common-dir HEAD` | 起動したとき 1 回 |
| `git rev-parse HEAD` | `.git` の変化から 3 秒後と、60 秒ごと |
| `git diff --name-only <前のコミット> <新しいコミット>` | HEAD が変わったとき |
| `npm run build` | 変わったファイルが画面かメインプロセスのとき（5 分で打ち切る） |

## 常駐の PowerShell
Node から Windows の API を直接呼べないので、`powershell.exe` を動かし続け、1 行の命令に 1 行で答えさせます。起動に 1〜2 秒かかるため、使い捨てにはしません。

| PowerShell | 起動 | 命令と、送るとき | コード |
|---|---|---|---|
| 前面のウィンドウ用 | ウィジェットを起動したとき（撮影のときは起動しない） | `fg`：ショートカット（`Ctrl+Alt+N`）を押したとき、知らせを出す前（Claude が前面か）、セッションを開いて 400ms 後<br>`open`：行をクリックしてセッションを開くとき<br>`raise`：開いたあと Claude が前面になかったとき<br>`wins`：ウィンドウの切り替えの一覧（3 秒ごと）<br>`icon`：初めて見たウィンドウのアイコン<br>`front`：ウィンドウの切り替えのアイコンを押したとき（前に出すか、前面なら最小化する） | `src/main/foreground.ts` |
| アプリバー用 | 固定（pinned）がオンで、最初の命令を送るとき。落ちたら次の命令で起動し直す | `new`、`query`、`set`、`remove`：ウィジェットを出したとき、置き場所や画面の大きさ、表示の倍率が変わったとき | `src/main/appbar.ts`、`src/main/powershell-line.ts` |

## そのほかのきっかけ
| きっかけ | すること | コード |
|---|---|---|
| ウィジェットの起動 | 設定（`%APPDATA%\Bantus\settings.json`）を読む。アプリのフォルダの `.git` を見て、ワークツリーの中から起動したかを決める | `src/main/settings-store.ts`、`src/main/main.ts` |
| 画面の追加・取り外し、表示の倍率の変更 | 置き直す。500ms と 2 秒後にもう一度確かめる | `src/main/main.ts`、`src/shared/display-layout.ts` |
| スリープからの復帰、ロックの解除 | 置き直す。1 秒、3 秒、8 秒後にもう一度確かめる | 同上 |
| カードの右クリックの「エクスプローラーで開く」 | Electron の `shell.openPath` でフォルダを開く | `src/main/main.ts` |
| カードの右クリックの「ターミナルで開く」 | Windows Terminal（`wt.exe -d <フォルダ>`）を起動する。なければ `cmd.exe /d /c start "" powershell.exe -NoLogo` | `src/main/open-folder.ts` |
| HTML ビューア（設定でオンのとき） | 一覧の読み直しのたびに、表示中の作業フォルダがあるかを確かめる | `src/main/viewer.ts` |
