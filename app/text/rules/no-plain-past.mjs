// textlint の自作規則：常体の過去形で終わる文（「〜た。」「〜なかった。」）を拾う。
// 画面の文で使うと感想のように読めるため（docs/strings.md の作風）。
// 「〜ました」「〜でした」（です・ます）は拾わない。文の終わりは「。」か、文言の最後。
// scripts/lint-ja.mjs が読み込む。

/** 文の終わりの「た」（直前が「まし」「でし」なら除く）と、「ん」「い」に続く「だ」（「読んだ」「泳いだ」） */
const PLAIN_PAST = /(?:(?<!まし|でし)た|(?<=[んい])だ)(?=。|$)/gu;

/** @type {import('@textlint/types').TextlintRuleModule} */
export default function noPlainPast(context) {
  const { Syntax, RuleError, report, getSource, locator } = context;
  return {
    [Syntax.Str](node) {
      const text = getSource(node);
      for (const m of text.matchAll(PLAIN_PAST)) {
        report(node, new RuleError('文が常体の過去形（「〜た」）で終わっています。お知らせは「です・ます」、状態は現在形で書いてください', {
          padding: locator.range([m.index, m.index + 1]),
        }));
      }
    },
  };
}
