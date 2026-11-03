# Bantus

Bantus（バンタス）という名前は、「番頭（Banto）がセッションの状態（Status）を見張って知らせる」という意味です。

Claude デスクトップ（Code タブ）を外から補うツールです。どのセッションが対応待ち・処理中・待機中かをひと目で見られるようにし、クリックやショートカットで目的のセッションを開けるようにします。

## フォルダ
| フォルダ | 中身 |
|---|---|
| [prototype/](prototype/README.md) | PowerShell と WPF の試作。セッション一覧ウィンドウとホットキー。今使えるのはこちら |
| [app/](app/README.md) | Electron 版のサイドバー型ウィジェット（最初の版を作成中） |
| [docs/](docs/README.md) | 調査結果（読み取れるデータ、セッションの状態の仕様など）と計画 |
| `tools/` | 検証用のスクリプト（`watch-status.ps1`：セッションの状態の変化を記録） |
| `package.json` | 一番上から `app/` のコマンドを動かすためだけのもの（`npm run setup`、`npm start`、`npm test`、`npm run debug` など） |
| `.githooks/` | 公開前の検査（個人情報と日付を残さない）。[docs/publishing.md](docs/publishing.md) |

## 注意
Claude デスクトップのデータを**読むだけ**で、書き換えはしません。読み取っているファイルの形式は公式には公開されていないので、アプリの更新で動かなくなることがあります。

Bantus は個人が作った非公式のツールで、Anthropic とは関係がありません。Anthropic が承認や支援をしているものでもありません。「Claude」は Anthropic の商標です。

## ライセンス
[MIT License](LICENSE)。画面のアイコンには [Lucide](https://lucide.dev)（ISC License。一部は Feather 由来で MIT License）を使っています。全文は [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) にあります。
