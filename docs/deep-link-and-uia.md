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
- Claude のウィンドウ自体が前面にあるかは、どちらの方法でもわかりません。必要なら `GetForegroundWindow` と比べます。
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
