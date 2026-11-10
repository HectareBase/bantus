# セッションの状態（`~/.claude/sessions/<pid>.json`）

CLI 2.1.309 の `claude.exe` の中のコードを読み、実際のファイルの変化も記録して確かめました。

## `status` の値
| `status` | 意味 | 確認方法 |
|---|---|---|
| `busy` | 処理中（応答の生成中、サブエージェントの実行中も含む） | 記録 |
| `idle` | 待機中（ターンが終わった） | 記録 |
| `waiting` | ユーザーの対応待ち。理由は `waitingFor` に入る | 記録 |
| （空・項目なし） | 起動した直後の一瞬だけ（約 0.3 秒） | 記録 |
| `shell` | 待機中で、バックグラウンドの Bash が動いている。端末版の画面（REPL）の経路だけが書き、デスクトップ版では書かれない | コードのみ（CLI 2.1.317） |

コード上の判定はこの順番です（CLI 2.1.309 の `JRe` / `DOo` 関数）。
1. 待ちの理由があれば → `waiting`
2. 読み込み中、またはサブエージェントが動いていれば → `busy`
3. それ以外 → `idle`

## `waitingFor` の値（`status` が `waiting` のときだけ入る）
コードで調べる順番に並べています。

| 値 | どんなとき | 確認方法 |
|---|---|---|
| `input needed` | 質問ダイアログ（AskUserQuestion）や、入力を求める画面 | 記録 |
| （ダイアログごとの値）例：`permission prompt` | ツールを使う許可を求めるダイアログ | 記録（`permission prompt`） |
| `worker request` | ワーカーからの要求待ち | コードのみ |
| `sandbox request` | サンドボックス外へのアクセスの許可待ち | コードのみ |
| `dialog open` | `/` コマンドなどの画面を開いているとき | コードのみ |
| `goal proposal` | ゴールの提案への回答待ち | コードのみ |

ダイアログごとの値は、表示しているダイアログが決めます。ここに挙げたもの以外の値が入る可能性もあるので、**知らない値は「対応待ち（その他）」として扱います**。

## 使われていなかった項目
`tempo`（`active` / `idle` / `blocked`）、`needs`、`state`、`detail` も読み込む処理がありますが、デスクトップの対話セッションでは一度も値が入りませんでした。バックグラウンドのジョブなど、別の仕組みで使うもののようです。

## 実際の記録
`tools/watch-status.ps1` で 0.3 秒ごとに読み、変化したときだけ記録しました。時間は、それぞれの試験を始めてからの秒数です。

**試験1：質問ダイアログ（このセッション）**
| 経過 | 状態 | していたこと |
|---|---|---|
| +0.0 秒 | `busy` | 記録を開始 |
| +5.1 秒 | `waiting` / `input needed` | 質問ダイアログを表示 |
| +23.6 秒 | `busy` | ユーザーが回答 |

**試験2：許可ダイアログ（テスト用セッション、許可モードは `default`）**
| 経過 | 状態 | していたこと |
|---|---|---|
| +0.0 秒 | （空）→ `busy` | セッションが起動（0.3 秒後に `busy`） |
| +7.3 秒 | `idle` | `Get-Date` を実行して終了。読み取りだけのコマンドは**承認なし**で実行され、`waiting` にはならなかった |
| +28.2 秒 | `busy` | ファイル書き込みを依頼 |
| +30.4 秒 | `waiting` / `permission prompt` | 書き込みの許可ダイアログを表示 |
| +48.4 秒 | `idle` | ユーザーが拒否 → ターンが止まり、そのまま `idle` に戻った |

生のログにはセッションのタイトルが入るので、リポジトリには入れていません（`local/` に保存）。

## バックグラウンドの作業
CLI 2.1.317 のコードを読み、実際にも試しました。

### デスクトップ版では `idle` になる
デスクトップ版の CLI は SDK の経路で状態を書きます。SDK の状態との対応は `running` → `busy`、`requires_action` → `waiting`、`idle` → `idle` です。ターンが終わると、バックグラウンドの作業（Bash の `run_in_background`、バックグラウンドのサブエージェント、Monitor）が動いていても `idle` になります。バックグラウンドで 25 秒動くコマンドを残してターンを終えたところ、その間ずっと `idle` でした。作業が終わると通知が入り、Claude が自分で次のターンを始めます（`busy` に戻る）。

CLI が受け付ける値は `busy`、`shell`、`idle`、`waiting` の 4 つです。`shell` は上の表のとおり、デスクトップ版では書かれません。来ても困らないよう、ウィジェットでは `idle` と同じに扱い、作業が 1 つ以上あるものとして表示します。

### 会話の記録での見分け方
`~/.claude/projects/<フォルダ>/<cliSessionId>.jsonl` に、作業の開始と終了が残ります。

| 種類 | 開始（`type:"user"` の行の `toolUseResult`） |
|---|---|
| Bash | `backgroundTaskId`。2 分を超えて自動でバックグラウンドに回ったときも同じで、`timedOutAfterMs` が付く |
| サブエージェント | `status` が `async_launched` で、`agentId` |
| Monitor | `taskId`。`timeoutMs` と `persistent` が付く |

- 終了：本文が `<task-notification>` で始まる行。中の `<task-id>` が開始の ID と同じで、`<status>` が `completed`、`failed`、`killed`、`stopped` のどれか。`queue-operation`（`enqueue` と `remove`）の行の `content` と、`type:"user"` の行の `message.content`（文字列）の両方に出るので、同じ ID は 1 回だけ数える
- Claude が `TaskStop` で作業を止めたときは、終了の通知が来ない（手元の記録で止めた 21 件のうち、通知が来たものは 0 件）。代わりに、`TaskStop` の結果（`type:"user"` の行の `toolUseResult`）の `message` が `Successfully stopped task` で始まり、`task_id`（止めた作業の ID）と `task_type`（`local_bash` など）が付く。これを終了と数える。止められなかったときの文（`No task found …` など）は数えない
- Monitor の途中のイベントの通知には `<status>` がないので、終了と数えない
- ツールの結果（`message.content` が配列）に同じ文字が出ることがあるので、本文が通知で始まる行だけを見る
- CLI を再起動すると、終了の通知がないまま作業が消える。古い記録には、開始だけで終了のない ID が実際に残っていた。そのため、`sessions/<pid>.json` の `startedAt` より前に始まった作業（行の `timestamp` で比べる）は数えない

### 読み方と負荷
- 待機中のセッションの記録だけを読む（処理中から待機になったときと、その後に記録が変わったとき）。前回読んだ位置を覚えて、増えた分だけ読む。注意点は [work-progress.md](work-progress.md) と同じ（最初の 1 回は全体、小さくなったら最初から、改行で終わっていない最後の行は残す）
- 全体の読み込みは 17 MB で約 36 ms。起動したときに 1 セッションにつき 1 回で、メインプロセスを長く止めないよう 1 MB ずつ間を空けて読む。差分の読み取りは約 0.2 ms（Defender が有効だと、書き換わった直後のファイルは約 6 ms）
- 作業が 1 つ以上ある待機中のセッションだけ、記録のファイルを見張る
- 実装は `app/src/main/background-work.ts`（数え方）と `app/src/main/jsonl-tail.ts`（差分の読み取り）

## ウィジェットでの使い方
ウィジェットがこの状態をどう表示するか（色と印、並び順）は、設計の資料 [widget-app-plan.md](../design/widget-app-plan.md) の「表示ルール」にあります。どの項目を読むかは [data-usage.md](../design/data-usage.md) にあります。
