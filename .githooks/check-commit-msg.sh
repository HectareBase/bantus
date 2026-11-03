#!/bin/sh
# コミットメッセージが決まり（docs/commit-messages.md）に合っているか調べる。
# 使い方:
#   check-commit-msg.sh FILE  コミットメッセージのファイルを調べる（commit-msg）
# 合わなければ、理由を表示して 1 で終わる。

# 種別と範囲の一覧。変えるときは docs/commit-messages.md もそろえる
TYPES='feat|fix|docs|refactor|perf|test|style|build|ci|chore|revert'
SCOPES='app|tools|docs|hooks'

file=$1
[ -f "$file" ] || { echo "コミットメッセージのファイルがありません：$file" >&2; exit 2; }

# git が付ける「#」の行と、先頭の空行を除いた 1 行目と 2 行目
body=$(grep -v '^#' "$file" | sed '/./,$!d')
subject=$(printf '%s\n' "$body" | sed -n 1p)
second=$(printf '%s\n' "$body" | sed -n 2p)

# git が作るメッセージは調べない
case "$subject" in
  'Merge '*|'Revert "'*|'fixup! '*|'squash! '*|'amend! '*) exit 0 ;;
esac

fail() {
  echo "コミットメッセージが決まりに合っていません：$1" >&2
  echo "  $subject" >&2
  echo "形：<種別>(<範囲>): <日本語の要約>（範囲は省いてよい）" >&2
  echo "種別：$TYPES" | sed 's/|/, /g' >&2
  echo "範囲：$SCOPES" | sed 's/|/, /g' >&2
  echo "詳しくは docs/commit-messages.md" >&2
  exit 1
}

[ -n "$subject" ] || fail "メッセージが空です"

printf '%s\n' "$subject" | grep -q -E "^($TYPES)(\(($SCOPES)\))?!?: [^ ]" ||
  fail "1 行目の形が違います"

summary=${subject#*: }
# 日本語（ASCII 以外の文字）が入っているか
printf '%s\n' "$summary" | LC_ALL=C grep -q '[^ -~]' ||
  fail "要約は日本語で書きます"

case "$summary" in
  *。) fail "要約の文末に句点は付けません" ;;
esac

[ -z "$second" ] ||
  fail "1 行目の後は、1 行空けてから本文を書きます"

exit 0
