# docs

Claude デスクトップ（Code タブ）を外から補うウィジェットアプリの資料です。調べて分かったこと（調査）と、アプリをどう作るか（設計）を分けて置いています。

## 調査（[research/](research/)）
Claude デスクトップと CLI について、調べて分かったことです。アプリの作り方には触れません。

| 文書 | 内容 |
|---|---|
| [data-sources.md](research/data-sources.md) | 読み取れるファイルの場所と項目、触ってはいけないファイル |
| [session-status.md](research/session-status.md) | セッションの状態（`busy` / `idle` / `waiting`）の仕様と、検証の記録 |
| [deep-link-and-uia.md](research/deep-link-and-uia.md) | `claude://` リンク、UIA で見える部品、今開いているセッションの見分け方、ホットキー、PowerShell 5.1 での注意 |

調査したのは、デスクトップアプリ 4.4212.0、CLI 2.1.309 です。アプリを更新したら、まず [data-sources.md](research/data-sources.md) に書いたパスと項目が変わっていないか確かめてください。

## 設計（[design/](design/)）
調査の結果を使って、ウィジェットをどう作るかを決めたものです。

| 文書 | 内容 |
|---|---|
| [widget-app-plan.md](design/widget-app-plan.md) | ウィジェットアプリの計画（Electron、サイドバー型）、表示ルール、これから決めること |
| [data-usage.md](design/data-usage.md) | ウィジェットが読むもの、動かすもの、書くもの、しないこと |
| [git-changes.md](design/git-changes.md) | コミットされていない変更の調べ方（`git status`）と表示 |
| [packaging-plan.md](design/packaging-plan.md) | exe 化とインストーラーの計画（electron-builder、NSIS）と、確かめた結果 |

## 開発の決まり
| 文書 | 内容 |
|---|---|
| [publishing.md](publishing.md) | 公開に向けた git の運用（個人情報と日付を残さない仕組み） |
| [commit-messages.md](commit-messages.md) | コミットメッセージの決まり（日本語、変更の種別と範囲） |
