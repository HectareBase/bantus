// HTML の data-i18n などに書いたキー（「widget.pinned」のような点区切り）から文言を引く。

import { ja } from './ja.js';

/** キーが文字列の文言を指していれば、その文字。なければ undefined（関数の文言も HTML からは使えない） */
export function lookupString(key: string): string | undefined {
  let node: unknown = ja;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, part)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** HTML で文言を入れる属性と、入れる先。data-i18n は中身の文字、ほかは属性 */
export const I18N_ATTRIBUTES = {
  'data-i18n': undefined,
  'data-i18n-tip': 'data-tip',
  'data-i18n-aria-label': 'aria-label',
} as const;
