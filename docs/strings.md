# 画面の文言

画面に出る文字は、すべて [`app/src/shared/strings/ja.ts`](../app/src/shared/strings/ja.ts) に書きます。main と renderer の両方がここから読みます。

## 書き方
- 文言は `ja` オブジェクトに、使う場所ごとのキーで置く（`ja.widget.pinned` など）
- 値が入る文言は関数にする（`minutesAgo: (n: number) => \`${n} 分前\``）。文字列をつなげて文を作らない
- HTML に書く文言は、`data-i18n`（中身の文字）、`data-i18n-tip`（ツールチップ）、`data-i18n-aria-label` にキーを書く。画面を開いたときに `renderer/strings.ts` が入れる
- ログ（`console.log` など）は対象外。日本語のまま書いてよい
- ほかの言語を足すときは、`en.ts` などを同じ形で作り、`satisfies Messages` で形を確かめる

## 作風
- 短い説明は「。」で終えない。2 文以上になるときだけ、文の間を「。」で区切る
- 半角の英数字の前後には空白を入れる（「Windows の通知」「3 秒」）。かっこやかぎかっこの隣は入れない
- 平易な言葉を使う。用語の表記は [`app/text/terms.yml`](../app/text/terms.yml) にそろえる

## 検査
| コマンド | 内容 |
|---|---|
| `npm run lint:ja` | `ja.ts` の文言を 1 つずつ textlint で検査する（規則は `app/.textlintrc`、関数は `app/scripts/lint-ja.mjs` の見本の引数で呼ぶ） |
| `npm test` | 上の検査に加えて、`src/` の `strings/` 以外のコメントでない所に日本語がないことを確かめる（`app/test/strings.test.ts`。ログなどの例外はそこの `ALLOWED` に書く） |

textlint で拾えない言い回しの不自然さは、スキル `review-ja`（`.claude/skills/review-ja/`）で `ja.ts` の差分を読んで見る。直すかどうかは人が決める。

規則が今の作風に合わないときは、文言ではなく `.textlintrc` を直してよい。そのときは、なぜ外したかを [`.textlintrc` の調整](#textlintrc-の調整) に足す。

## `.textlintrc` の調整
| 規則 | 調整 | 理由 |
|---|---|---|
| `ja-no-mixed-period`（preset-ja-technical-writing） | 外す | 短い説明は「。」で終えない作風のため |
| `ja-space-between-half-and-full-width` | `space: "always"` | 半角の英数字の前後に空白を入れる作風のため |
