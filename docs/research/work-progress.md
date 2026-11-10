# セッションの作業状況

セッションの行に「今何をしているか」を出せるかを調べました。デスクトップアプリ 4.23118.0、CLI 2.1.317 の手元のファイル（デスクトップのセッション 165 件、会話の記録 86 件）を読んで確かめています。**どれも公式には公開されていない形式**です。

## 結論
出せます。ただし、ターンが終わったあとと処理中とで、使えるものが違います。

| 状況 | 使えるもの | 読み取り元 | 鮮度 |
|---|---|---|---|
| ターンが終わったあと | `postTurnSummary.status_detail`（短いまとめ） | `local_*.json` | ターンが終わるときに更新される |
| ターンが終わったあと | `postTurnSummary.status_category`、`needs_action` | 同上 | 同上 |
| 処理中 | タスクリスト（手順の名前、今どの手順か） | 会話の記録 `projects/<フォルダ名>/<cliSessionId>.jsonl` | 呼び出しのたびにすぐ書かれる |
| 処理中 | 今のツールの呼び出しと、その `description` | 同上 | 同上 |

`~/.claude/sessions/<pid>.json` には作業状況の項目はありません（`status` と `waitingFor` だけ。[session-status.md](session-status.md)）。

## `local_*.json`：終わったターンのまとめ
| 項目 | 中身 |
|---|---|
| `postTurnSummary.status_category` | `completed`（多い）、`blocked`、`review_ready`。項目がないセッションもある |
| `postTurnSummary.status_detail` | 1 行のまとめ。平均 41 文字、最長 144 文字。行の下の段に入る長さ |
| `postTurnSummary.needs_action` | `blocked` のとき、ユーザーにしてほしいこと。ほかは空 |
| `postTurnSummary.summarizes_uuid` / `postTurnSummaryFor` | まとめた発言の UUID |
| `lastAssistantUuid` | 最後のアシスタントの発言の UUID |
| `lastTurnReport` | 最後の報告の全文（長い） |
| `turnWrapUp.description` | wrap_up の recap にあたる文（2〜3 文） |
| `sideSessionNotes[]` | 子のセッションからの報告（`sessionId`、`title`、`report`、`at`） |
| `lastTurnEdgeAt` / `latestUserFrameAt` | ターンの区切りと、最後のユーザーの発言の時刻（Unix ミリ秒） |

- **処理中は前のターンのまとめのままです。** 新しいターンが始まっても `postTurnSummary` は消えず、ターンが終わるまで書き換わりません。今のターンのまとめかどうかは、`postTurnSummaryFor` と `lastAssistantUuid` を比べると分かります。
- タスクリストは、このファイルにはありません。

## 会話の記録：タスクリスト
手元のすべての記録に、タスクリストのツール `mcp__ccd_turn__update_plan` とまとめのツール `mcp__ccd_turn__wrap_up` の呼び出しが入っていました。呼び出し（`type: "assistant"` の `message.content[]` の `tool_use`）と結果（`type: "user"` の `tool_result`）が、その場で追記されます。

### 呼び出しの形（`input` の項目と回数）
| 形 | 回数 | 意味 |
|---|---|---|
| `items`、`scope` | 627 | リスト全体（`content` と `status`：`pending` / `in_progress` / `completed`）。前のリストを置き換える |
| `advance` | 725 | 今の手順を終え、次の手順を始める |
| `done`、`start` | 72 | 番号（1 から）で終わった手順と始める手順を指す |
| `done` | 4 | 終わった手順だけを指す |
| wrap_up：`recap`（と `ask`、`actions`、`blocked`） | 477 | ターンの終わり |

### 結果の文
| 文 | 意味 |
|---|---|
| `Plan shown (N steps).` | 新しいリスト |
| `Plan updated: step N of M is in progress.` | N 番目の手順の途中 |
| `Plan updated: steps N, N of M are in progress; …` | 2 つ以上が途中（まれ） |
| `Plan updated: every step is done.` | すべて終わった |

結果の文のあとに `App actions available now: commit, verify.` などが続くことがあります。

### 作り直し方
1. 最後の `items` の呼び出しから、手順の名前と状態を取る
2. その後の `advance`、`done`、`start` を順に当てはめる
3. 結果の文の「step N of M」で、ずれていないかを確かめる（結果の文だけでも「2/3」は出せる）
4. `wrap_up` の呼び出しがあれば、そのターンは終わったと見なす

今のツールを出したいときは、最後の `tool_use` の `name` と、`Bash` / `PowerShell` なら `input.description` が使えます。

## 読み方の注意
- **末尾だけ読む方法では足りません。** 記録には API の要求そのもの（`api-request-blob` など）が入っていて大きくなります。最後の `items` の呼び出しは、記録の末尾から中央値で約 160 KB、最大で約 5.7 MB 前にありました（152 件中 64 KB より前が 104 件、1 MB より前が 17 件、4 MB より前が 1 件）。
- そのため、前回読んだ位置（バイト数）を覚えて、増えたぶんだけを読み、タスクリストの状態を持ち続ける方法がよいです。最初の 1 回だけは全体を読みます。ファイルが小さくなったら最初から読み直します。
- 書き込み途中の最後の行は、改行で終わるまで読まずに残します。
- 1 つの発言が content のブロックごとに複数の行に分かれて記録されることがあるので、同じ `tool_use.id` は 1 回だけ数えます。
- 手順の名前と `description` は発言の中身にあたります。ウィジェットで使うなら、[data-usage.md](../design/data-usage.md) の「発言の中身を画面に出さない」という決まりを、この 2 つに限って変える必要があります。

## 表示の案
| 状態 | 出すもの |
|---|---|
| 処理中 | 「2/3 セッションのファイルの中身を調べる」（タスクリスト。なければ今のツールの `description`） |
| 対応待ち、待機中 | `status_detail`。`blocked` で `needs_action` があればそちらを優先 |
