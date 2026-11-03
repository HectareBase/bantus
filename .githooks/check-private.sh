#!/bin/sh
# 公開してはいけない情報（日付、ユーザーフォルダ、メールアドレス、個人の語句）が含まれていないか調べる。
# 使い方:
#   check-private.sh --staged        コミットしようとしている内容を調べる（pre-commit）
#   check-private.sh --message FILE  コミットメッセージを調べる（commit-msg）
#   check-private.sh --all           追跡しているすべてのファイルを調べる
# 見つかったら、その行を表示して 1 で終わる。

root=$(git rev-parse --show-toplevel) || exit 2
patterns="$root/.githooks/private-patterns.txt"
words="$root/local/private-words.txt"
# 公開してよいメールアドレス
ALLOW='noreply@anthropic\.com|@users\.noreply\.github\.com'

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
grep -v -E '^[[:space:]]*(#|$)' "$patterns" > "$tmp/patterns"
if [ -f "$words" ]; then
  grep -v -E '^[[:space:]]*(#|$)' "$words" > "$tmp/words"
else
  : > "$tmp/words"
fi

found=0

# $1: 調べる内容のファイル、$2: 表示用の名前
check_file() {
  hits=$(grep -n -E -f "$tmp/patterns" "$1" 2>/dev/null | grep -v -E "$ALLOW")
  if [ -s "$tmp/words" ]; then
    more=$(grep -n -i -F -f "$tmp/words" "$1" 2>/dev/null)
    hits=$(printf '%s\n%s' "$hits" "$more" | sed '/^$/d')
  fi
  if [ -n "$hits" ]; then
    echo "[check-private] $2:" >&2
    printf '%s\n' "$hits" | sed 's/^/    /' | cut -c1-200 >&2
    found=1
  fi
}

# 検査の定義そのものは調べない。npm が作るロックファイルも調べない（外部パッケージの説明文に、作者のメールアドレスが入る）
skip() {
  case "$1" in
    .githooks/*) return 0 ;;
    package-lock.json|*/package-lock.json) return 0 ;;
  esac
  return 1
}

case "$1" in
  --staged)
    git diff --cached --name-only --diff-filter=ACMR > "$tmp/files"
    while IFS= read -r f; do
      skip "$f" && continue
      git show ":$f" > "$tmp/content" 2>/dev/null || continue
      check_file "$tmp/content" "$f"
    done < "$tmp/files"
    ;;
  --message)
    # Git が付けるコメント行は除く
    grep -v '^#' "$2" > "$tmp/content"
    check_file "$tmp/content" "コミットメッセージ"
    ;;
  --all)
    git ls-files > "$tmp/files"
    while IFS= read -r f; do
      skip "$f" && continue
      [ -f "$root/$f" ] && check_file "$root/$f" "$f"
    done < "$tmp/files"
    ;;
  *)
    echo "usage: check-private.sh --staged | --message FILE | --all" >&2
    exit 2
    ;;
esac

if [ "$found" -ne 0 ]; then
  echo "[check-private] 公開してはいけない情報が見つかりました。書き換えてから、もう一度実行してください。" >&2
  echo "[check-private] 誤検出なら .githooks/private-patterns.txt を見直してください（--no-verify で飛ばすのは最後の手段）。" >&2
  exit 1
fi
exit 0
