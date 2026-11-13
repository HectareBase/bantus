# Bantus

Claude デスクトップ（Code タブ）を外から補うツール。セッション一覧、状態の表示、ショートカット。調査結果と計画は [docs/](docs/README.md) にある。

## 守ること
- Claude のデータ（`%LOCALAPPDATA%\Claude-Data`、`~/.claude`）は**読むだけ**。書き込み、移動、削除はしない
- 認証情報を含むファイル（`config.json`、`ssh-remote-server-state.json`、`~/.claude.json`、`sessions/*.key`）は読まない。一覧は [docs/research/data-sources.md](docs/research/data-sources.md)
- セッションを開くときは `claude://claude.ai/epitaxy/<local_ID>` を使う。UIA のクリックは補助としてだけ使う
- 公開を前提にしている。個人情報と日付を書かない。コミットは git フック（`.githooks/`）が検査する。コミットの日時は書き換えない。詳しくは [docs/publishing.md](docs/publishing.md)
- コミットメッセージは日本語で、1 行目を `<種別>(<範囲>): <要約>` にする（例：`feat(app): ツールチップを自前で描く`）。`commit-msg` フックが検査する。詳しくは [docs/commit-messages.md](docs/commit-messages.md)
- 画面に出る文字は `app/src/shared/strings/ja.ts` にだけ書く。`npm run lint:ja` で検査する。詳しくは [docs/strings.md](docs/strings.md)
- 状態の判定は [docs/research/session-status.md](docs/research/session-status.md) に従う。知らない `waitingFor` の値は「対応待ち（その他）」として扱う
- 機能の追加や修正は、main のチェックアウトで直接進めない。ワークツリーを作り、その作業フォルダで新しいセッションを始めて進める。すでにワークツリーのセッションにいるときはそのまま進める。質問への回答、調査、ドキュメントだけの小さな変更は今のセッションでよい
  - 新しいワークツリーは、手元のブランチの最新から切る。リモートの写し（`origin/...`）は手元より古いことが多く、切り元を指定しないと古い状態から切られる
  - 作る前に、分岐元をユーザーに見せて確かめる。候補は今のセッションのブランチ（`git branch --show-current`）と `main` で、それぞれの最新のコミット（`git log -1 --format="%h %s" <ブランチ>`）と、今のブランチが `main` にない変更を持っていればその数を添える。`AskUserQuestion` で選んでもらい、答えを待ってから作る
  - すぐ始めるとき（`initiation` が `user_asked` か `offer`）は、`start_session` に `use_worktree: true` と `source_branch: <選んだブランチ>` を渡す
  - 提案カード（`initiation: "own_initiative"`）では `source_branch` が捨てられる。だからブリーフの最初の手順に「作業の前に `git merge --ff-only <選んだブランチ>` で追いつき、`git log -1 <選んだブランチ>` と同じコミットにいることを確かめる」と、ブランチ名を書き入れて書く

## フォルダ
| フォルダ | 中身 |
|---|---|
| `docs/` | 資料。`research/` に調査結果、`design/` に設計、直下に開発の決まり |
| `tools/` | 検証用と作業用のスクリプト（ワークツリーの片付けはスキル `clean-worktrees` から使う） |
| `app/` | Electron 版のウィジェット。`npm start` で起動、`npm test` でテスト（`npm run lint:ja` も含む）、`npm run lint:ja` で画面の文言の検査、`npm run debug` で見本データの表示、`npm run typecheck` で型の確認（一番上でも `app/` でも動く。一番上の `package.json` は `app/` に渡すだけ） |
| `app/native/` | 常駐の補助プログラム（C）。`npm run build` が MSVC があればビルドする。`npm run build:native` で単独に |
| `app/src/shared/strings/` | 画面の文言（`ja.ts`） |
| `app/text/` | 用語の辞書（`terms.yml`、prh の形式） |
| `.claude/skills/` | スキル（`clean-worktrees`、文言の見直しの `review-ja`） |
| `.githooks/` | 公開前の検査 |
| `local/` | 手元専用。git に入れない（生のログ、個人の語句のリスト） |

## `tools/` のスクリプト（PowerShell 5.1）
- 構文チェック：`[System.Management.Automation.Language.Parser]::ParseFile(...)`
- 日本語を含む `.ps1` は BOM 付き UTF-8 で保存する。`.cmd` には日本語を書かない
- 状態の変化を確かめるときは `tools/watch-status.ps1` を使う（ログは `local/status-log.txt`）
