# 試作：セッション一覧とショートカット

Claude デスクトップ（Code タブ）用の、セッション一覧ウィンドウとショートカットの試作です。PowerShell 5.1 だけで動き、追加インストールは不要です。

## 起動と終了
- 起動：`start-hotkeys.cmd` をダブルクリック（コンソールウィンドウは出ません）
- 終了：一覧ウィンドウの「終了」ボタン。× は隠すだけです
- Windows の起動時に自動で立ち上げたい場合は、`start-hotkeys.cmd` のショートカットを `shell:startup` フォルダに置きます

## セッション一覧
| 操作 | 動き |
|---|---|
| `Ctrl+Alt+L` | 一覧の表示 / 非表示 |
| クリック / Enter | そのセッションを Claude で開く |
| 文字を入力 | タイトルまたはフォルダ名で絞り込み |
| ↑ ↓ | 選択を移動 |
| Esc | 隠す |

行の左端の色はフォルダごとの色です。印は `●` が処理中、`○` が起動中（待機）、印なしは停止中のセッションです。行にマウスを乗せると、最後のターンのまとめが表示されます。アーカイブ済みのセッションは表示しません。

## shortcuts.json
最初に `shortcuts.example.json` を `shortcuts.json` という名前でコピーし、自分用に書き換えます。`shortcuts.json` は手元専用で、git には入れません（ないときは見本を使います）。

| 項目 | 意味 |
|---|---|
| `openMethod` | `link`：`claude://` リンクで開く / `uia`：サイドバーの行を UIA でクリックする（見つからなければリンクで開く） |
| `hideListAfterOpen` | 開いたあとに一覧を隠すか |
| `showListOnStart` | 起動時に一覧を表示するか |
| `refreshSeconds` | 一覧を自動更新する間隔（秒） |
| `hotkeys` | キー → 動作 |
| `folderColors` | フォルダ名（作業フォルダの末尾）→ 色 |
| `defaultColor` | `folderColors` にないフォルダの色 |

キーは `Ctrl` / `Alt` / `Shift` / `Win` と、キー名（`A`〜`Z`、`1`〜`9`、`F1`、`Space` など）を `+` でつなげて書きます。

動作は次の4種類です。
```json
{ "action": "toggleList" }          // 一覧の表示 / 非表示
{ "open": "local_xxxxxxxx-..." }    // セッション ID を指定して開く
{ "openByTitle": "バグ修正" }        // タイトルに含まれる文字で探して開く
{ "click": "ターミナル" }            // Claude 画面の、この名前のボタンを押す
```
設定を変えたら、「終了」してから起動し直してください。他のアプリが使っているキーは登録できず、起動時にメッセージが出ます（`Ctrl+Alt+Space` は使用中でした）。

## 読み取っているデータ
- `%LOCALAPPDATA%\Claude-Data\claude_*\claude-code-sessions\...\local_*.json`：タイトル、作業フォルダ、最終更新、アーカイブの有無
- `%USERPROFILE%\.claude\sessions\*.json`：実行中のセッションの状態（busy / idle）

読むだけで、書き換えはしません。どちらも公式には公開されていない形式なので、アプリの更新で動かなくなった場合は `session-list.ps1` の `Get-ClaudeSessions` を直します。
