# Bantus

Claude デスクトップ（Code タブ）を外から補うツール。セッション一覧、状態の表示、ショートカット。調査結果と計画は [docs/](docs/README.md) にある。

## 守ること
- Claude のデータ（`%LOCALAPPDATA%\Claude-Data`、`~/.claude`）は**読むだけ**。書き込み、移動、削除はしない
- 認証情報を含むファイル（`config.json`、`ssh-remote-server-state.json`、`~/.claude.json`、`sessions/*.key`）は読まない。一覧は [docs/data-sources.md](docs/data-sources.md)
- セッションを開くときは `claude://claude.ai/epitaxy/<local_ID>` を使う。UIA のクリックは補助としてだけ使う
- 公開を前提にしている。個人情報と日付を書かない。コミットは git フック（`.githooks/`）が検査する。コミットの日時は書き換えない。詳しくは [docs/publishing.md](docs/publishing.md)
- コミットメッセージは日本語で、1 行目を `<種別>(<範囲>): <要約>` にする（例：`feat(app): ツールチップを自前で描く`）。`commit-msg` フックが検査する。詳しくは [docs/commit-messages.md](docs/commit-messages.md)
- 状態の判定は [docs/session-status.md](docs/session-status.md) に従う。知らない `waitingFor` の値は「対応待ち（その他）」として扱う
- 機能の追加や修正は、main のチェックアウトで直接進めない。ワークツリーを作り、その作業フォルダで新しいセッションを始めて進める（`start_session` に `use_worktree: true` を渡す）。すでにワークツリーのセッションにいるときはそのまま進める。質問への回答、調査、ドキュメントだけの小さな変更は今のセッションでよい

## フォルダ
| フォルダ | 中身 |
|---|---|
| `docs/` | 調査結果と計画 |
| `prototype/` | PowerShell と WPF の試作（セッション一覧、ホットキー） |
| `tools/` | 検証用のスクリプト |
| `app/` | Electron 版のウィジェット。`npm start` で起動、`npm test` でテスト、`npm run debug` で見本データの表示、`npm run typecheck` で型の確認（一番上でも `app/` でも動く。一番上の `package.json` は `app/` に渡すだけ） |
| `.githooks/` | 公開前の検査 |
| `local/` | 手元専用。git に入れない（生のログ、個人の語句のリスト） |

## 今の試作（PowerShell 5.1 と WPF）
- 起動：`prototype/start-hotkeys.cmd`（`-STA` で `claude-hotkeys.ps1` を起動）
- 構文チェック：`[System.Management.Automation.Language.Parser]::ParseFile(...)`
- 日本語を含む `.ps1` は BOM 付き UTF-8 で保存する。`.cmd` には日本語を書かない
- WPF のイベントハンドラでは `GetNewClosure()` を使わず、状態は `$script:UI` に置く
- 状態の変化を確かめるときは `tools/watch-status.ps1` を使う（ログは `local/status-log.txt`）
