# docs

Claude デスクトップ（Code タブ）を外から補うウィジェットアプリのための、調査結果と計画です。

| 文書 | 内容 |
|---|---|
| [data-sources.md](data-sources.md) | 読み取れるファイルの場所と項目、触ってはいけないファイル |
| [session-status.md](session-status.md) | セッションの状態（`busy` / `idle` / `waiting`）の仕様と、検証の記録 |
| [git-changes.md](git-changes.md) | コミットされていない変更の調べ方（`git status`）と表示 |
| [deep-link-and-uia.md](deep-link-and-uia.md) | `claude://` リンク、UIA で見える部品、ホットキー、PowerShell 5.1 での注意 |
| [widget-app-plan.md](widget-app-plan.md) | ウィジェットアプリの計画（Electron、サイドバー型）と、これから決めること |
| [packaging-plan.md](packaging-plan.md) | exe 化とインストーラーの計画（electron-builder、NSIS） |
| [publishing.md](publishing.md) | 公開に向けた git の運用（個人情報と日付を残さない仕組み） |
| [commit-messages.md](commit-messages.md) | コミットメッセージの決まり（日本語、変更の種別と範囲） |

調査したのは、デスクトップアプリ 4.4212.0、CLI 2.1.309 です。アプリを更新したら、まず [data-sources.md](data-sources.md) に書いたパスと項目が変わっていないか確かめてください。
