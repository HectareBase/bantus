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

### リンクを開くのにかかる時間
- `shell.openExternal`（Electron）でリンクを開くと、MSIX 版の `claude.exe` がもう 1 つ起動し、動いている本体に URL を渡してから終わります。ここまでで約 260 ms かかりました。そのあとで本体がセッションを切り替える時間は、外からは縮められません。
- 前面のウィンドウを調べるのは、常駐させた PowerShell なら 1 回 5 ms 前後です。
- リンクを開くたびにプロセスが 1 つ起動するので、ウイルス対策や EDR がプロセスの起動を検査する PC では、その分だけ遅れるおそれがあります（この PC では測っていません）。

### プロセスを起動せずにリンクを渡す（`WM_COPYDATA`）
2 つ目の `claude.exe` が本体に URL を渡すのは、Electron（Chromium）の単一インスタンスの仕組みです。同じメッセージを外から直接送ると、プロセスを起動せずにセッションが切り替わりました。往復で 2 回試し、どちらも切り替わりました。
- 送り先：`claude` 本体（メインウィンドウを持つプロセス）のメッセージ専用ウィンドウ（`HWND_MESSAGE` の子）。クラスは `Chrome_MessageWindow`、タイトルはデータフォルダ（`%LOCALAPPDATA%\Claude-Data\claude_*`）のフルパスです。同じクラスでタイトルが空のウィンドウがほかにもあるので、タイトルで探します（`FindWindowEx(HWND_MESSAGE, 0, "Chrome_MessageWindow", <パス>)`）。
- メッセージ：`WM_COPYDATA`。`dwData` は 0、`lpData` は UTF-16 の `START\0<作業フォルダ>\0<コマンドライン>\0`、`cbData` は末尾の `\0` を 1 つ足したバイト数です。コマンドラインは `"<claude.exe のパス>" claude://claude.ai/epitaxy/<local_ID>` で動きました。作業フォルダは何でも構いません。
- Electron の追加データ（`requestSingleInstanceLock` の引数）は付けていません。付けなくても受け付けられました。
- `SendMessageTimeout`（`SMTO_ABORTIFHUNG`）の戻りは成功で、結果は 1 でした。かかった時間は 1 ms 以下です。そのあとで本体が切り替える時間は、リンクのときと変わりません。
- 本体はメッセージを受けると、自分でウィンドウを前に出します。最小化していれば元に戻します。
- 前面に出るかは、ウィジェットに組み込んで確かめました。ウィジェットの画面からセッションを開く処理を呼び、ウィジェットが前面のときに 4 回、Claude を最小化したときに 1 回試しました。どれも送ってから約 0.1〜0.25 秒で Claude が前面になり、セッションも切り替わりました（`lastFocusedAt` で確認）。新しい `claude.exe` は 1 つも起動しませんでした。
- 送る前に `AllowSetForegroundWindow(<本体の pid>)` で許可を渡しています。送る側（ウィジェットが常駐させた PowerShell）は前面にないので、そのままでは呼んでも失敗します。割り当てのない仮想キー（`0x88`）を押して離したことにしてから呼ぶと成功しました（「ウィンドウを前に出す」と同じ手）。
- 許可を渡さなくても前に出たことがあります。ただ、別のアプリが前面にある状態で試したときに、前に出なかったことが 1 回ありました。条件は絞りきれていないので、許可は渡しておき、念のため 0.4 秒後に前面を確かめ、`claude` でなければ「ウィンドウを前に出す」の方法で前に出します。
- 本体のプロセスは、メッセージ専用ウィンドウの持ち主（`GetWindowThreadProcessId`）から取ります。`claude` という名前のプロセスには、Claude Code CLI の `claude.exe`（`Claude-Data` の下）も混じるので、名前では選びません。コマンドラインに入れる exe のパスも、この持ち主のものを使います（WindowsApps の下）。
- リンクとの速さを比べました（各 3〜4 回）。リンクは `Start-Process` で開き、`WM_COPYDATA` は同じ PowerShell から送りました。どちらも、2 つ目の `claude.exe` が URL を渡すまでの時間がなくなった分だけ速くなり、その差は約 0.2 秒です。

  | 測ったこと | リンク | `WM_COPYDATA` |
  |---|---|---|
  | Claude を最小化した状態から、前面に戻るまで | 266〜341 ms | 71〜98 ms |
  | Claude を前面に置いたまま、セッションだけが切り替わるまで | 393〜448 ms | 182〜197 ms |
  | 送り終える（`Start-Process` が戻る、`SendMessageTimeout` が戻る）まで | 32〜103 ms | 2〜8 ms |

  - 切り替わりは、UIA の `ControlType.Document` の名前（「タイトル - Claude Code」）が変わった時点で判断しました。名前を 1 回読むのに 15〜45 ms かかるので、その分だけ粗い値です。会話の本文が描き終わるまでの時間ではありません。
  - `WM_COPYDATA` で残る約 180〜200 ms は、本体の中で画面を切り替える時間で、外からは縮められません。
  - 試した PC では、ウイルス対策によるプロセス起動の遅れはほとんど見られませんでした。プロセスの起動を検査する PC では、リンクのほうがさらに遅くなり、差は開くと考えられます。
- 送る中身の形は Chromium と Electron の内部仕様で、Claude の更新で変わりえます。ウィンドウが見つからないとき、結果が 0 のとき、切り替わらないときは、リンクで開き直す必要があります。

### ウィンドウを前に出す
すでに開いているセッションを前面に出すだけなら、リンクを使わずに Claude のウィンドウを直接前に出すほうが速くなります（約 50 ms）。ウィジェットのショートカットはこの方法を使い、失敗したときだけセッションを開き直します（`WM_COPYDATA`、それもだめならリンク）。
- `claude` プロセスの `MainWindowHandle` を取り、最小化されていれば `ShowWindow(SW_RESTORE)`、そのあと `SetForegroundWindow` を呼びます。
- 前面にないプロセスから呼ぶと、`SetForegroundWindow` は Windows に断られて false を返します（`AttachThreadInput` で前面のスレッドにつないでも同じでした）。
- 割り当てのない仮想キー（`0x88`）を `keybd_event` で押して離したことにしてから呼び直すと、前に出せました。どのアプリもこのキーを使わないので、前面のアプリには何も起きません。
- 前に出したあとで前面のプロセスが `claude` になったかを確かめ、なっていなければセッションを開き直します。

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
- Claude のウィンドウ自体が前面にあるかは、どちらの方法でもわかりません。`GetForegroundWindow`（user32.dll）で前面のウィンドウを取り、そのプロセス名が `claude` かで見分けられます。
- 分割表示で複数のセッションを並べているときに、どれを指すかは確かめていません（最後にフォーカスしたものと思われます）。
- サイドチャット（btw）を表示しているときは、サイドチャットの `lastFocusedAt` が一番新しくなります。親に置き換えて扱います（[data-sources.md](data-sources.md#サイドチャットbtw)）。
- ウィジェットでの使い方は、設計の資料 [data-usage.md](../design/data-usage.md) にあります。

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
