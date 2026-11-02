# 公開に向けた git の運用

公開したときに、**個人情報**（名前、メールアドレス、ユーザーフォルダ、自分のプロジェクト名やセッションのタイトル）と、**ファイルやコミットメッセージに書いた日付**が残らないようにする仕組みです。

**コミットの日時は書き換えません。** git が記録した日時とタイムゾーン（日本なら +0900）は、そのまま公開されます。

## 何が守られるか
| 漏れる場所 | 対策 | 仕組み |
|---|---|---|
| ファイルの中身 | コミットのときに検査し、見つかったらコミットを止める | `.githooks/pre-commit` |
| コミットメッセージ | 同じ検査。あわせて書き方の決まり（[commit-messages.md](commit-messages.md)）も調べる | `.githooks/commit-msg` |
| 作者の名前とメールアドレス | このリポジトリ専用の設定を使う。push のときに確認する | `.githooks/pre-push` |
| 個人の設定、生のログ | git に入れない | `.gitignore`（`local/`、`prototype/shortcuts.json`） |

`push` の前には `pre-push` がもう一度すべてを確かめ、問題があれば `push` を止めます。

## 最初の設定（1 回だけ）
```bash
git config core.hooksPath .githooks
git config user.name "<公開してよい名前>"
git config user.email "<GitHub のユーザー ID>+<ユーザー名>@users.noreply.github.com"
```
- メールアドレスは、GitHub の Settings → Emails にある **noreply のアドレス**を使います。あわせて「Keep my email addresses private」をオンにします。
- `--global` は付けません。このリポジトリだけの設定にします。

## 検査の対象
`.githooks/private-patterns.txt`（公開してよい、一般的な正規表現）
- 日付（年月日の形のもの）
- Windows のユーザーフォルダ（`C:` から始まり `Users` を含むパス。`%USERPROFILE%` と書けば通る）
- メールアドレス（`noreply@anthropic.com` と GitHub の noreply アドレスは通る）
- Claude のセッション ID（`local_` から始まる ID）

`local/private-words.txt`（git に入れない、個人の語句）
- 自分の名前、ユーザー名、自分のほかのプロジェクト名など。1 行に 1 つ、大文字小文字を区別しない部分一致です。

すべてのファイルを手で調べるとき：
```bash
.githooks/check-private.sh --all
```

## 困ったとき
- **誤検出でコミットできない**：`.githooks/private-patterns.txt` を見直します。`--no-verify` で飛ばすのは最後の手段です（飛ばしても `pre-push` で止まります）。
- **グローバルの設定のメールアドレスでコミットしてしまった**：`pre-push` が知らせます。`.githooks/fix-commit-author.sh` で、まだ push していないコミットの名前とメールアドレスを直します（日時は変わりません）。push 済みのコミットには使いません。
- **書いてはいけないことがすでにコミットされている**：push する前なら、直してから `git commit --amend`、または履歴を書き換えます。push した後なら、公開リポジトリの履歴から消す作業が必要になるので、まず相談してください。

## 文書を書くときの決まり
- 日付は書かず、「調べたバージョン」（デスクトップアプリ 4.4212.0、CLI 2.1.309 など）で時点を表す
- 時刻の記録は、試験を始めてからの経過秒数にする
- 例に使う名前は、`my-app`、`バグ修正` のような一般的なものにする
- パスは `%USERPROFILE%`、`%LOCALAPPDATA%`、`~` を使って書く
