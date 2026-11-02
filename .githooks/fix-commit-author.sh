#!/bin/sh
# まだ push していないコミットの名前とメールアドレスを、このリポジトリ専用の設定に書き換える（日時は変えない）。
# 使い方: .githooks/fix-commit-author.sh [範囲]
#   範囲を省くと、上流ブランチがあれば「上流..HEAD」、なければ全履歴が対象。
# 履歴を書き換えるので、push 済みのコミットには使わない。

# filter-branch の中で使われている変数名とぶつからないよう、PRIV_ を付ける
PRIV_NAME=$(git config --local user.name)
PRIV_EMAIL=$(git config --local user.email)
if [ -z "$PRIV_NAME" ] || [ -z "$PRIV_EMAIL" ]; then
  echo "このリポジトリ専用の user.name と user.email を先に設定してください（docs/publishing.md）。" >&2
  exit 1
fi

range="$1"
if [ -z "$range" ]; then
  if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null); then
    range="$upstream..HEAD"
  else
    range="HEAD"
  fi
fi

export PRIV_NAME PRIV_EMAIL
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --env-filter '
  GIT_AUTHOR_NAME="$PRIV_NAME"; GIT_AUTHOR_EMAIL="$PRIV_EMAIL"
  GIT_COMMITTER_NAME="$PRIV_NAME"; GIT_COMMITTER_EMAIL="$PRIV_EMAIL"
  export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL
' -- $range
