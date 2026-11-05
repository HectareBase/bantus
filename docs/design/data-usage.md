# ウィジェットが読むもの、書くもの

Electron 版のウィジェット（`app/`）が、実際に何を読み、何に使い、何をしないかをまとめます。読み取り元のファイルの形式と項目の意味は、調査の資料 [data-sources.md](../research/data-sources.md) にあります。

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
| `%USERPROFILE%\.claude\sessions\<pid>.json` | `sessionId`、`pid` | 動いている CLI のプロセスを見つける（`pid` のプロセスが今もあるかを確かめ、ファイルだけ残ったものは除く） | `src/main/sessions.ts` |
| | `status`、`waitingFor` | 状態（対応待ち、処理中、待機）と、対応待ちの理由。判定は [session-status.md](../research/session-status.md) | |
| | `cwd` | セッションの途中でワークツリーに入ったときに、そのワークツリーを見つける | |
| 作業フォルダの `.git`（ファイル）と `.git/HEAD`（ワークツリーなら `.git/worktrees/<名前>/HEAD`） | 今のブランチ名 | 元のフォルダのカード（家のアイコン）と、リポジトリの外のワークツリーのカードの見出しに出す。どちらも `local_*.json` の `branch` には入らない | `src/main/sessions.ts` |

- 上の 2 つのフォルダは `fs.watch` で見張り、変わったら読み直します。取りこぼしに備えて、30 秒ごとにも読み直します。
- 書き込み途中のファイルを読むことがあるので、読めなかったファイルは飛ばし、次の読み直しを待ちます。

## 動かすもの
| 何を | 使い道 | コード |
|---|---|---|
| `git --no-optional-locks -C <作業フォルダ> status --porcelain=v2 --branch` | コミットされていない変更の件数。リポジトリには書き込まない。詳しくは [git-changes.md](git-changes.md) | `src/main/git-status.ts` |
| `git --no-optional-locks -C <作業フォルダ> rev-list` / `rev-parse` | ワークツリーの元のブランチからの遅れと、マージ済みかどうか。読むだけ。詳しくは [worktree-cards.md](worktree-cards.md) | `src/main/git-status.ts` |
| `powershell.exe`（起動したら動かし続ける） | 前面のウィンドウのプロセス名が `claude` かを調べる（`GetForegroundWindow`）。プロセス名だけを受け取り、ウィンドウの中身は読まない | `src/main/foreground.ts` |
| `claude://` のリンク | セッションを開く | `src/main/main.ts` |

## 書くもの
ウィジェットが書き込むのは、自分のフォルダだけです。

| 場所 | 中身 |
|---|---|
| `%APPDATA%\Bantus\settings.json` | 設定。Bantus の中だけのアーカイブ（手で入れた・外したセッションとカード）もここに入れる。デスクトップの `isArchived` には書かない |
| `%APPDATA%\Bantus\` のほかのファイル | Electron が自分で作るもの（キャッシュなど） |
| Windows のスタートアップの登録 | 「Windows の起動時に開く」をオンにしたときだけ（`app.setLoginItemSettings`） |

見本データ（`npm run debug`）で起動したときは、`bantus-debug` という別のフォルダを使います。ワークツリーの中から起動したときは `Bantus-wt-<ワークツリー名>`（見本データならさらに `-debug`）を使い、初回だけいつもの `settings.json` を読んで写します（[app/README.md](../../app/README.md) の「ワークツリーで動かす」）。撮影を頼んだときだけ、指定した場所に PNG を書きます。

## しないこと
- Claude のデータ（`Claude-Data`、`~/.claude`）には書き込みません。動かすことも、消すこともしません
- 認証情報を含むファイル（`config.json`、`ssh-remote-server-state.json`、`~/.claude.json`、`sessions/*.key`）は読みません
- 会話の記録（`~/.claude/projects/*.jsonl`）、`git-worktrees.json`、`window-state.json` は読みません。調査はしましたが、今は使っていません
- UIA（Windows UI Automation）で画面の部品を読んだり、押したりはしません。セッションは `claude://` のリンクで開きます
- 読んだ内容をネットワークに送りません。ログにも出しません
