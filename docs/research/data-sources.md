# Claude デスクトップから読めるデータ

調査したバージョンはデスクトップアプリ 4.4212.0、Claude Code CLI 2.1.309（Windows 11、MSIX 版）です。
**どれも公式には公開されていない形式**なので、アプリを更新したら変わる可能性があります。ウィジェットからは**読むだけ**にし、書き込みはしません。ウィジェットが実際に読む項目と使い道は、設計の資料 [data-usage.md](../design/data-usage.md) にあります。

## 一覧
| 情報 | 読み取り元 | 主な項目 |
|---|---|---|
| サイドバーのセッション一覧 | `%LOCALAPPDATA%\Claude-Data\claude_*\claude-code-sessions\<id>\<id>\local_*.json` | タイトル、作業フォルダ、最終更新、アーカイブの有無、最後のターンのまとめ |
| アーカイブ済みのセッションの一覧 | 同じフォルダの `archived-sessions.idx` | アーカイブ済みのセッションの ID |
| 実行中のセッションの状態 | `%USERPROFILE%\.claude\sessions\<pid>.json` | `busy` / `idle` / `waiting`、待ちの理由 → [session-status.md](session-status.md) |
| 会話の全記録 | `%USERPROFILE%\.claude\projects\<フォルダ名>\<CLIのセッションID>.jsonl` | 発言、ツール呼び出し、タイトルの変更、タスクリスト → [work-progress.md](work-progress.md) |
| ワークツリーの一覧 | `%LOCALAPPDATA%\Claude-Data\claude_*\git-worktrees.json` | ワークツリーの名前、場所、ブランチ、使っているセッション（`leasedBy`） |
| ウィンドウの位置と大きさ | `%LOCALAPPDATA%\Claude-Data\claude_*\window-state.json` | `x`, `y`, `width`, `height`, `isMaximized` |
| 画面の部品 | UIA（Windows UI Automation） | → [deep-link-and-uia.md](deep-link-and-uia.md) |

`claude_*` の部分は MSIX パッケージの ID です。

## `local_*.json`（デスクトップのセッション1件につき1ファイル）
| 項目 | 例 / 意味 |
|---|---|
| `sessionId` | `local_xxxxxxxx-...`。`claude://` リンクやアプリのツールで使う ID |
| `cliSessionId` | `xxxxxxxx-...`。CLI 側の ID。`~/.claude/sessions/*.json` の `sessionId`、`projects/` の jsonl のファイル名と同じ値 |
| `title` / `titleSource` | タイトルと、付けた方法（`auto` / `tool` など） |
| `cwd` / `originCwd` | 作業フォルダと、元のリポジトリのフォルダ（ワークツリーのときに違う値になる） |
| `worktreeName` / `worktreePath` | ワークツリーの名前と場所（ワークツリーのときだけ） |
| `branch` / `sourceBranch` | ワークツリーのブランチと、作成元のブランチ（ワークツリーのときだけ。例：`claude/xxxx-xxxx-1a2b3c`、`main`） |
| `gitAnchors[]` | `gitRoot`（リポジトリのフォルダ）と `commonDir`（`.git` の場所）。`commonDir` はワークツリーでも同じ値なので、リポジトリの目印になる。git 管理でないフォルダでは空。リポジトリの外のワークツリー（`git worktree add` で作ったもの）で始めたセッションでは 2 つになり、1 つ目の `gitRoot` はワークツリーのフォルダ、2 つ目は元のリポジトリ。`commonDir` はどちらも元のリポジトリの `.git` |
| `model` / `effort` / `permissionMode` | `claude-opus-5-5` / `medium` / `auto` |
| `isArchived` | アーカイブ済みなら `true` |
| `createdAt` / `lastActivityAt` / `lastFocusedAt` | Unix ミリ秒。`lastFocusedAt` が一番新しいものが、デスクトップで今開いているセッション → [deep-link-and-uia.md](deep-link-and-uia.md#今開いているセッションを知る) |
| `completedTurns` | 終わったターンの数 |
| `postTurnSummary.status_category` | `completed` など |
| `postTurnSummary.status_detail` | 例：「abc1234 committed; tests pass; not pushed」 |
| `postTurnSummary.needs_action` | ユーザーの対応が必要なとき、その内容（空なら不要） |
| `turnWrapUp.description` | 最後のターンのまとめの文章 |
| `spawnedFrom` | 別のセッションから作られたときだけ。`sessionId`（元のセッション）、`sideSession`、`btw` など |
| `forkedFromSessionId` | フォークしたときの元のセッション（サイドチャットにも付く） |

### サイドチャット（btw）
- サイドチャットも `local_*.json` を 1 つ持ちます。目印は `spawnedFrom.btw: true` で、親は `spawnedFrom.sessionId` です。タイトルは多くが `btw: ` で始まりますが、目印には使いません。
- デスクトップのサイドバーには出ません。
- 表示すると、親とサイドチャットの両方の `lastFocusedAt` が書かれ、サイドチャットのほうが少し後になります。今開いているセッションを決めるときは、親に置き換えます。
- `spawnedFrom` があっても `btw` がないもの（別のセッションとして立ち上げたもの）は、普通のセッションとしてサイドバーに出ます。

- **ピン留めとサイドバーのグループの情報は、このファイルには入っていません。** アプリのツール（`list_sessions` の `pinned` / `group`）からは取れます。
- サイドバーに表示されるフォルダ名は、作業フォルダの末尾の名前とは限りません（例：作業フォルダ `my-app` が `MyApp` と表示される。リポジトリ名のようです）。

## `archived-sessions.idx`（`local_*.json` と同じフォルダに 1 つ）
アーカイブ済みのセッションの ID を並べた JSON です。拡張子は `.idx` ですが、中身は 1 行の JSON です。

```
{"v":1,"archived":["local_xxxxxxxx-...","local_xxxxxxxx-...", ...]}
```

| 項目 | 意味 |
|---|---|
| `v` | 形式の版。調べたときは `1` |
| `archived` | アーカイブ済みのセッションの `sessionId`（`local_` で始まる ID）。ファイル名から `.json` を除いたものと同じ |

- 190 件の `local_*.json` と照らし合わせたところ、`isArchived: true` の 96 件とこの一覧の 96 件が 1 件も違わずに一致しました。
- これを使うと、`local_*.json` を 1 つずつ読まなくても、アーカイブ済みかどうかが分かります。
- 確かめていないこと
  - アーカイブしたとき、またアーカイブを戻したときに、このファイルと `local_*.json` のどちらが先に書かれるか
  - このファイルがないとき（アーカイブしたことがないなど）に、どうなるか

  使うときは、`v` が `1` でない、ファイルがない、読めないときに、`local_*.json` の `isArchived` を見るやり方に戻すのが安全です。

## `~/.claude/sessions/<pid>.json`（実行中の CLI プロセス1つにつき1ファイル）
| 項目 | 意味 |
|---|---|
| `pid` / `procStart` | プロセス ID と起動時刻。**ファイルだけが残っていることがある**ので、そのプロセスが今も動いているかを確かめる |
| `sessionId` | CLI のセッション ID（`local_*.json` の `cliSessionId` と同じ値） |
| `name` / `nameSource` / `formerNames` | セッション名と、付けた方法（`user` / `auto` / `derived` など）、以前の名前 |
| `cwd` / `kind` / `entrypoint` | 今の作業フォルダ、`interactive`、`claude-desktop`。セッションの途中で EnterWorktree を使うと `cwd` はワークツリーに変わるが、`local_*.json`（`cwd`、`worktreeName` など）と `git-worktrees.json` は元のままで、デスクトップのサイドバーでも元のリポジトリのセッションとして出る |
| `status` / `waitingFor` | 状態と、待ちの理由 |
| `updatedAt` / `statusUpdatedAt` | 最後にファイルが更新された時刻と、状態が変わった時刻（Unix ミリ秒） |

## 触ってはいけないもの
次のファイルには、ログイン用のトークンやアカウント情報が入っています。ウィジェットから読み込まないでください。ログに出したり、どこかへ共有したりもしないでください。

- `Claude-Data\claude_*\config.json`（`oauth:tokenCache` など）
- `Claude-Data\claude_*\ssh-remote-server-state.json`
- `~/.claude.json`（`oauthAccount`）
- `~/.claude/sessions/*.key`

`Claude-Data` フォルダの `README.txt` には「このフォルダの中身を消したり、動かしたり、名前を変えたりしない」と書かれています。
