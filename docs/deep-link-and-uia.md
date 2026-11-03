# セッションを開く方法、UIA、ホットキー

デスクトップアプリ 4.4212.0 で確認しました。

## `claude://` リンク（おすすめ）
```
claude://claude.ai/epitaxy/<local_のセッションID>
```
- `Start-Process "claude://claude.ai/epitaxy/local_..."` で、そのセッションに切り替わります（ユーザーが確認済み）。
- ID は `local_*.json` の `sessionId` です。
- アプリのログ（`%LOCALAPPDATA%\Claude\logs\main.log`）には、リンクを受け取った記録は残りません。
- 画面の構造が変わっても影響を受けないので、UIA でクリックするより壊れにくい方法です。

### ほかのリンク
アプリ本体（`app.asar` の `claudeURLHandler`）を読んで見つけたものです。「試した」の列が ✅ のものは、実際に開いて確かめました。

| リンク | 動き | 試した |
|---|---|---|
| `claude://code/continue?session=<local_ID>` | そのセッションを開く。アーカイブ済みのセッションは開かず、新規作成の画面になる | ✅ |
| `claude://code/continue?session=last` | アーカイブしていないセッションのうち、`lastActivityAt` が一番新しいものを開く（最後に開いたものではない） | ✅ |
| `claude://code/needs-input` | 権限の確認待ち（`pendingToolPermissions`）のセッションのうち、一番古くから待っているものを開く。ないときは新規作成の画面になる | ✅（待ちがないときだけ） |
| `claude://code/needs-input?session=<local_ID>` | 待っているセッションの中からそれを開く。なければ一番古いものを開く | |
| `claude://code/new` | 新規作成の画面を開く | ✅ |
| `claude://code/new?q=<文>` | 入力欄に文を入れて開く。**送信はしない**。最大 14336 文字 | ✅ |
| `claude://code/new?folder=<パス>` | フォルダを選んで開く。リンクから開くと、信頼したことのあるフォルダでも毎回「このワークスペースを信頼しますか？」の確認が出る。`folder` は何度でも付けられる | ✅ |
| `claude://code/new?ssh_host=<host>&ssh_port=<port>&ssh_folder=<パス>` | SSH 先で新規作成。`folder` と一緒には使えない | |
| `claude://code/search` | セッションの検索を開く（UIA では `Window`「検索」） | ✅ |
| `claude://code/<cse_… / session_…>` | クラウドのセッションを開く | |
| `claude://claude.ai/resume?session=<CLIのUUID>` | CLI のセッションをデスクトップに取り込んで開く。**取り込みは書き込みになるので使わない** | |
| `claude://claude.ai/new?q=<文>&surface=chat` | チャットを新しく始める（`surface=cowork` なら Cowork） | |
| `claude://claude.ai/chat/<UUID>`、`claude://claude.ai/project/<UUID>` | チャット、プロジェクトを開く | |
| `claude://claude.ai/settings`、`customize`、`directory`、`cowork`、`local_sessions` | それぞれの画面を開く | |
| `claude://cowork/new?q=…&folder=…`、`claude://cowork/shared-artifact?uuid=…` | Cowork のタスクを作る、共有された成果物を開く | |

- `code/new`、`code/continue`、`code/needs-input`、`claude.ai/new` は、アプリがジャンプリスト（Linux ではデスクトップエントリの Actions）に登録しているリンクです。
- `continue` と `needs-input` は、ログインしていないときや、設定（`disableDeepLinks`）でリンクが止められているときは動きません。
- リンクで開いてから `local_*.json` の `lastFocusedAt` が書き換わるまで、3 秒以上かかることがありました。開いた直後に「今開いているセッション」を読むときは注意してください。

### 新規作成のリンクとワークツリー
- `code/new` が受け取る引数は `q`（または `prompt`）、`folder`、`file`、`ssh_host` / `ssh_port` / `ssh_folder`、`environment` / `runner_pool` だけです。ほかの引数は捨てられます。
- ワークツリーを使うかどうか（`useWorktree`）と、元にするブランチ（`sourceBranch`）は、新規作成の画面で選びます。リンクからは渡せません。
- 既存のワークツリーのフォルダを `folder` に渡したときの動きは、ワークツリーの場所で変わります。

| ワークツリーの場所 | 信頼の確認に出るパス | 選ばれるフォルダ |
|---|---|---|
| リポジトリの中（`.claude\worktrees\<名前>`。アプリが作る場所） | 元のリポジトリ | 元のリポジトリ |
| リポジトリの外（`git worktree add` で作ったもの） | ワークツリーのフォルダ | ワークツリーのフォルダ |

- 「ワークツリー」のチェックは、ワークツリーの場所では決まりません。前に新規作成したときの状態が記憶されます。

- リポジトリの中のワークツリーは、パスを変えても別のブランチでは始められません。アプリが自分で管理するワークツリー（`isManagedWorktreePath`）を、元のリポジトリとして扱うためのようです。
- リポジトリの外のワークツリーなら、そのフォルダで新規作成の画面を開けます。ただし「ワークツリー」のチェックがオンのまま送信すると、そこからさらに新しいワークツリーが作られるはずです。チェックはリンクではオフにできません。
- チェックを外して送信すると、1 回目はそのワークツリーのフォルダとブランチのまま動きました。ところが同じ手順を繰り返すと、画面のフォルダ欄にはワークツリーのフォルダが出ているのに、送信すると `LocalSessions.createScratchWorkspace` が呼ばれ、`Claude-Data\claude_*\scratch-workspaces\` の中に作られた空のフォルダ（`scratch-…`）で始まりました。どちらになるかを決める条件は分かっていません。この判断は画面側（ウェブのコード）でしていて、`app.asar` には入っていません。
- 同じフォルダを新規作成の画面で手で選んで送信すると、そのフォルダとブランチのまま動きました。scratch になるのは、リンクで渡したときだけです。
- こうして始めたセッションは、アプリからはワークツリーとして扱われません。`local_*.json` の `cwd` / `originCwd` はワークツリーのフォルダになり、`worktreeName` / `worktreePath` / `branch` は空です。`gitAnchors` は 2 つになります（下の [data-sources.md](data-sources.md) を参照）。

## UIA（Windows UI Automation）
`System.Windows.Automation` で、Claude のメインウィンドウ（`claude` プロセスの `MainWindowHandle`）から読み取れます。試したときの要素の数は、全部で 368 個でした。

| 部品 | UIA での見え方 |
|---|---|
| サイドバーのセッション行 | `Button`。名前は「タイトル フォルダ名」（例：`ログイン画面のバグ修正 my-app`） |
| 行のメニュー | `Button`。名前は「タイトルのその他のオプション」 |
| フォークしたセッション | 名前の末尾が「〜からフォーク」 |
| 状態の見出し | `Button`：`処理中`、`アイドル`、`ピン留め済み`、`アイドルの5件をさらに表示` |
| 上部のボタン | `ターミナル`、`変更`、`ブラウザ`、`ファイル`、`新規作成`、`検索`、`サイドバーを非表示`、`戻る`、`進む` |
| タブの切り替え | `RadioButton`：`チャットと Cowork`、`Code` |
| 会話本文 | `ListItem` などで、文章まで読める |

注意点
- `AutomationId`（`_r_3hvi_` など）は React が付ける値で、起動のたびに変わります。**名前で探してください。**
- 名前は表示している言語によって変わります（今は日本語）。
- 「さらに表示」に隠れているセッションは、UIA からは見つかりません。
- ボタンは `InvokePattern` で押せます。

## 今開いているセッションを知る
次の 2 つの方法で判別できました。

| 方法 | わかること | 弱いところ |
|---|---|---|
| `local_*.json` の `lastFocusedAt` が一番新しいもの（おすすめ） | `sessionId` がそのまま取れる | ファイルが書かれるまで少し遅れるかもしれない（未計測） |
| UIA の `ControlType.Document` の名前（「タイトル - Claude Code」） | 画面に出ているセッションのタイトル | タイトルしかわからない（同じ名前を区別できない）。表示言語で変わる |

- ウィンドウのタイトル（`MainWindowTitle`）は `Claude` だけで、使えません。
- Claude のウィンドウ自体が前面にあるかは、どちらの方法でもわかりません。ウィジェットは `GetForegroundWindow` のウィンドウのプロセス名が `claude` かで判断しています（`app/src/main/foreground.ts`）。
- 分割表示で複数のセッションを並べているときに、どれを指すかは確かめていません（最後にフォーカスしたものと思われます）。
- サイドチャット（btw）を表示しているときは、サイドチャットの `lastFocusedAt` が一番新しくなります。親に置き換えて扱います（[data-sources.md](data-sources.md#サイドチャットbtw)）。
- ウィジェットは `lastFocusedAt` を使い、その行の背景色を変えています。

## ホットキー
- PowerShell 5.1 から `RegisterHotKey`（user32.dll）で登録できます。`MOD_NOREPEAT` を付け、メッセージ専用ウィンドウ（`HWND_MESSAGE`）で `WM_HOTKEY` を受け取ります。
- **`Ctrl+Alt+Space` は他のアプリが使用中で、登録できませんでした**（Claude のクイック入力の可能性があります）。今は代わりに `Ctrl+Alt+L` を使っています。
- `Ctrl+Alt+L`、`Ctrl+Alt+T`、`Ctrl+Alt+B` は登録できました。

## PowerShell 5.1 で作るときの注意
- 日本語を含む `.ps1` ファイルは、**BOM 付きの UTF-8** で保存します。BOM がないと ANSI として読まれ、文字化けします。
- JSON は `[IO.File]::ReadAllText($path, UTF8)` で読みます。`Get-Content` は、何も指定しないと ANSI として読みます。
- `.cmd` ファイルには日本語を書きません（cmd は CP932 で読むので、誤動作することがあります）。
- WPF のイベントハンドラで `GetNewClosure()` を使うと、スクリプトの関数や `$script:` の変数が見えなくなります。状態は `$script:` のハッシュテーブルに置き、`Dispatcher.Run()` の中で呼ばれる前提にします。
- WPF は `-STA` で起動する必要があります。
