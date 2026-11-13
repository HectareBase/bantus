# ウィジェットが読むもの、書くもの

Electron 版のウィジェット（`app/`）が、実際に何を読み、何に使い、何をしないかをまとめます。読み取り元のファイルの形式と項目の意味は、調査の資料 [data-sources.md](../research/data-sources.md) にあります。いつ、どのくらいの頻度で読んだり動かしたりするかは [io-schedule.md](io-schedule.md) にあります。

## 読むもの
| 読み取り元 | 使う項目 | 使い道 | コード |
|---|---|---|---|
| `%LOCALAPPDATA%\Claude-Data\claude_*\claude-code-sessions\<id>\<id>\local_*.json` | `sessionId` | 行をクリックしたときに開く `claude://claude.ai/epitaxy/<ID>` | `src/main/sessions.ts` |
| | `cliSessionId` | 実行中の状態（下の行）と結び付ける | |
| | `title` | 行に出すセッション名 | |
| | `cwd`、`originCwd`、`gitAnchors`、`worktreeName`、`worktreePath`、`branch` | リポジトリごとにまとめ、ワークツリーごとのカードに分ける。ブランチ名を出す | |
| | `sourceBranch` | ワークツリーの元のブランチ。遅れとマージ済みを調べる | |
| | `isArchived`、`spawnedFrom` | アーカイブ済みとサイドチャット（btw）を一覧から外す。`spawnedFrom.sessionId` は、一覧のタイムラインのつながりと起点を見つけるのにも使う | |
| | `createdAt`、`lastActivityAt` | 並び順と「◯分前」。同じワークツリーで残すセッション（最後に動いたもの）を決める | |
| | `lastFocusedAt` | デスクトップで今開いているセッション（その行の背景色、`Ctrl+Alt+N` の次の行、通知を出すかどうか）。サイドチャットのときは親に置き換える | |
| | `postTurnSummary.needs_action`、`postTurnSummary.status_detail` | ツールチップの「対応が必要」と、最後のターンのまとめ | |
| | `turnWrapUp.description` | 以前のセッションの一覧で、乗せた行のまとめを下の段に出す | |
| | `model` | コンテキストの窓の大きさを対応表から決める（[worktree-cards.md](worktree-cards.md) の「コンテキストの使用量」） | `src/main/context-usage.ts` |
| `%USERPROFILE%\.claude\sessions\<pid>.json` | `sessionId`、`pid` | 動いている CLI のプロセスを見つける（`pid` のプロセスが今もあるかを確かめ、ファイルだけ残ったものは除く） | `src/main/sessions.ts` |
| | `status`、`waitingFor` | 状態（対応待ち、処理中、待機）と、対応待ちの理由。判定は [session-status.md](../research/session-status.md) | |
| | `cwd` | セッションの途中でワークツリーに入ったときに、そのワークツリーを見つける | |
| `%USERPROFILE%\.claude\projects\<フォルダ>\<cliSessionId>.jsonl` の**末尾だけ**（64 KB から、見つからなければ 4 MB まで広げる） | 最後のアシスタントの発言（`type` が `assistant`、`isSidechain` でないもの）の `message.usage` の `input_tokens`、`cache_read_input_tokens`、`cache_creation_input_tokens`。`local_*.json` に `model` がなければ `message.model` | コンテキストの使用量（分子）。窓の大きさ（分母）はモデルの対応表から決める推定で、表にないモデルは割合を出さない。大きさと更新時刻が変わったときだけ読み直す。アーカイブ済みのセッションの記録は読まない。発言の中身は使わず、どこにも送らない | `src/main/context-usage.ts` |
| `%USERPROFILE%\.claude\projects\<フォルダ>\<cliSessionId>.jsonl`（**処理中のセッションだけ**。前回読んだ位置から増えた分だけ。最初の 1 回だけ全体） | 本当のユーザーの発言（`type` が `user` で、ツールの結果でも `isMeta` でもないもの）の位置。アシスタントの発言（`isSidechain` でないもの）の `mcp__ccd_turn__update_plan` の呼び出しの `input` のうち、`items[].status` と `advance`、`done`、`start`。`mcp__ccd_turn__wrap_up` の呼び出しがあったこと | 今のターンのタスクリストの手順の数と状態を作り直し、状態の札の中に棒で出す（手順が 2 つ以上のときだけ）。手順の名前（`items[].content`）と発言の中身は使わず、画面にもログにも出さない。処理中の間だけファイルを `fs.watch` で見張り、手順の数か状態が変わったときだけ画面を描き直す。作り直し方と読み方は [work-progress.md](../research/work-progress.md) | `src/main/plan-progress.ts` |
| 作業フォルダの `.git`（ファイル）と `.git/HEAD`（ワークツリーなら `.git/worktrees/<名前>/HEAD`） | 今のブランチ名 | 元のフォルダのカード（家のアイコン）と、リポジトリの外のワークツリーのカードの見出しに出す。どちらも `local_*.json` の `branch` には入らない | `src/main/sessions.ts` |

| 作業フォルダの中の HTML ファイル（設定の「ファイルの場所」） | ファイルそのもの | HTML ビューアに出す。設定でオンにしたときだけ（既定はオフ）。今開いているセッションの作業フォルダの中だけで、ファイルの入ったフォルダを `fs.watch` で見張る。詳しくは [html-viewer.md](html-viewer.md) | `src/main/viewer.ts` |

- 上の 2 つのフォルダは `fs.watch` で見張り、変わったら読み直します。取りこぼしに備えて、30 秒ごとにも読み直します。
- 書き込み途中のファイルを読むことがあるので、読めなかったファイルは飛ばし、次の読み直しを待ちます。
- 行をクリックしてから本体が `lastFocusedAt` を書き込むまで、3 秒以上かかることがあります。その間はクリックした行を仮に今開いているものとして塗ります（`src/renderer/model.ts` の `resolveFocus`）。仮の値は、ファイルがクリックしたセッションに追いついたとき、クリックより新しい `lastFocusedAt` を持つ別のセッションが出たとき（本体で別のセッションを開いた）、クリックしたセッションが一覧から消えたときに外します。時間では外さないので、書き込みが遅れても前の行に戻って揺れることはありません。本体で開けなかったときに残り続けないよう、30 秒の期限だけは残しています。

## 動かすもの
| 何を | 使い道 | コード |
|---|---|---|
| `git --no-optional-locks -C <作業フォルダ> status --porcelain=v2 --branch` | コミットされていない変更の件数。リポジトリには書き込まない。設定の「未追跡のファイルを数える」をオフにすると `--untracked-files=no` を付ける。詳しくは [git-changes.md](git-changes.md) | `src/main/git-status.ts` |
| `git --no-optional-locks -C <作業フォルダ> rev-list` / `rev-parse` | ワークツリーの元のブランチからの遅れと、マージ済みかどうか。読むだけ。取得がオンのときは `refs/remotes/<リモート>/<元のブランチ>` も見る。詳しくは [worktree-cards.md](worktree-cards.md) | `src/main/git-status.ts` |
| `git --no-optional-locks -C <フォルダ> config --get branch.<元のブランチ>.remote` | 取得するリモートの名前。設定の「定期的に取得する」がオンのときだけ | `src/main/git-fetch.ts` |
| `git -C <フォルダ> -c credential.interactive=never fetch --no-auto-gc --no-auto-maintenance --no-write-fetch-head --quiet <リモート>`（`GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=never`） | 設定の「定期的に取得する」が**オンのときだけ**（既定はオフ）。アーカイブしていないカードがあるリポジトリごとに、選んだ間隔（5 / 10 / 30 分）で動かす。ユーザーがリポジトリに設定したリモートと git の通信をする。ログインの画面は出さない。詳しくは [git-fetch.md](git-fetch.md) | `src/main/git-fetch.ts` |
| `powershell.exe`（起動したら動かし続ける） | 前面のウィンドウのプロセス名が `claude` かを調べる（`GetForegroundWindow`）。プロセス名だけを受け取り、ウィンドウの中身は読まない | `src/main/foreground.ts` |
| `claude://` のリンク | セッションを開く | `src/main/main.ts` |
| HTML ビューアに出したページの JavaScript | 設定でオンにしたときだけ。preload のない別のビュー（sandbox、保存しないパーティション）で動かし、ページの移動、新しいウィンドウ、権限の要求、ダウンロードは止める。http(s) のリンクはいつものブラウザーに渡す（[html-viewer.md](html-viewer.md)） | `src/main/viewer.ts` |

## 書くもの
ウィジェットが書き込むのは、自分のフォルダだけです。ただし、設定で取得をオンにしたときは、git がリポジトリの `.git` の中のリモートの写し（`refs/remotes/<リモート>/*`）と、取ってきたオブジェクトを書きます。作業中のファイル、インデックス、ローカルのブランチ、HEAD、stash、`FETCH_HEAD` には触れません（[git-fetch.md](git-fetch.md)）。

| 場所 | 中身 |
|---|---|
| `%APPDATA%\Bantus\settings.json` | 設定。Bantus の中だけのアーカイブ（手で入れた・外したセッションとカード）もここに入れる。デスクトップの `isArchived` には書かない |
| | 保留の印（`holds`、`heldCards`）。セッションの ID かカードの目印ごとに、理由のメモ（200 文字まで）と保留にした時刻を入れる（[hold.md](hold.md)）。メモはこのファイルにだけ入れ、ほかへ送らず、ログにも出さない。外したメモは保存せず、ウィジェットを閉じるまで中だけで覚える |
| `%APPDATA%\Bantus\` のほかのファイル | Electron が自分で作るもの（キャッシュなど） |
| Windows のスタートアップの登録 | 「Windows の起動時に開く」をオンにしたときだけ（`app.setLoginItemSettings`） |

見本データ（`npm run debug`）で起動したときは、`bantus-debug` という別のフォルダを使います。ワークツリーの中から起動したときは `Bantus-wt-<ワークツリー名>`（見本データならさらに `-debug`）を使い、初回だけいつもの `settings.json` を読んで写します（[app/README.md](../../app/README.md) の「ワークツリーで動かす」）。撮影を頼んだときだけ、指定した場所に PNG を書きます。

## しないこと
- Claude のデータ（`Claude-Data`、`~/.claude`）には書き込みません。動かすことも、消すこともしません
- 認証情報を含むファイル（`config.json`、`ssh-remote-server-state.json`、`~/.claude.json`、`sessions/*.key`）は読みません
- 会話の記録（`~/.claude/projects/*.jsonl`）からは、コンテキストの使用量（末尾だけを読み、使用量の数とモデル名）と、処理中のセッションのタスクリストの手順の数と状態のほかは使いません。手順の名前を含む発言の中身を画面に出したり、ほかへ送ったり、ログに出したりはしません。会話の記録のフォルダ全体は見張らず、見張るのは処理中のセッションの記録のファイルだけです
- `git-worktrees.json`、`window-state.json` は読みません。調査はしましたが、今は使っていません
- UIA（Windows UI Automation）で画面の部品を読んだり、押したりはしません。セッションは Claude 本体に `WM_COPYDATA` を送って開き、送れなかったときだけ `claude://` のリンクで開きます（[deep-link-and-uia.md](../research/deep-link-and-uia.md#プロセスを起動せずにリンクを渡すwm_copydata)）
- 読んだ内容をネットワークに送りません。ログにも出しません。取得をオンにしたときの git の通信（リポジトリのリモートとの `git fetch`）だけは除きます。そこでも Bantus が読んだもの（セッション、会話）は送りません
- 取得の失敗の内容はログに出しません。設定画面に、リポジトリ名と失敗の種類だけを出します
