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
# ワークツリーには local/ がないので、本体のチェックアウトのものを使う
if [ ! -f "$words" ]; then
  common=$(cd "$root" && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  [ -n "$common" ] && words="$(dirname "$common")/local/private-words.txt"
fi
# 公開してよい語句（個人の語句の一部として一致しても通す）
allowed="$root/.githooks/allowed-words.txt"
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
if [ -f "$allowed" ]; then
  grep -v -E '^[[:space:]]*(#|$)' "$allowed" > "$tmp/allowed"
else
  : > "$tmp/allowed"
fi

found=0
failed=0

# grep や awk がエラーで終わったとき、素通りさせずに検査を失敗させる
fail() {
  echo "[check-private] $1 の検査に失敗しました（終了コード $2）。" >&2
  failed=1
}

# 個人の語句を、英字の大文字小文字を区別せずに部分一致で探す。公開してよい語句の部分は除いてから調べる。
# GNU grep 3.0（Git Bash）は、日本語を含む語句で grep -i -F -f が落ちるので、awk で英字だけ小文字にそろえて比べる。
# $1: 調べる内容のファイル
find_words() {
  LC_ALL=C awk -v wordsfile="$tmp/words" -v allowfile="$tmp/allowed" '
    BEGIN {
      sep = sprintf("%c", 1)
      while ((r = getline w < wordsfile) > 0) { sub(/\r$/, "", w); if (w != "") words[++nw] = tolower(w) }
      if (r < 0) exit 2
      while ((r = getline a < allowfile) > 0) { sub(/\r$/, "", a); if (a != "") allow[++na] = tolower(a) }
      if (r < 0) exit 2
    }
    {
      l = tolower($0)
      for (i = 1; i <= na; i++) {
        while ((p = index(l, allow[i])) > 0)
          l = substr(l, 1, p - 1) sep substr(l, p + length(allow[i]))
      }
      for (i = 1; i <= nw; i++) if (index(l, words[i]) > 0) { print NR ":" $0; next }
    }
  ' "$1"
}

# $1: 調べる内容のファイル、$2: 表示用の名前
check_file() {
  grep -n -E -f "$tmp/patterns" "$1" > "$tmp/hits"
  rc=$?
  if [ "$rc" -ge 2 ]; then fail "$2（パターン）" "$rc"; return; fi
  hits=$(grep -v -E "$ALLOW" "$tmp/hits")
  if [ -s "$tmp/words" ]; then
    more=$(find_words "$1")
    rc=$?
    if [ "$rc" -ne 0 ]; then fail "$2（個人の語句）" "$rc"; return; fi
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

if [ "$failed" -ne 0 ]; then
  echo "[check-private] 検査を最後までできませんでした。.githooks/check-private.sh を見直してください。" >&2
  exit 1
fi
if [ "$found" -ne 0 ]; then
  echo "[check-private] 公開してはいけない情報が見つかりました。書き換えてから、もう一度実行してください。" >&2
  echo "[check-private] 誤検出なら .githooks/private-patterns.txt を見直してください（--no-verify で飛ばすのは最後の手段）。" >&2
  exit 1
fi
exit 0
