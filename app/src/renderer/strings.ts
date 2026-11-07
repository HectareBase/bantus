// HTML に書いた data-i18n などのキーに、shared/strings/ja.ts の文言を入れる。テンプレートの中身にも入れる

import { I18N_ATTRIBUTES, lookupString } from '../shared/strings/lookup.js';

export function fillStrings(doc: Document) {
  const roots: ParentNode[] = [doc, ...[...doc.querySelectorAll('template')].map((t) => t.content)];
  for (const root of roots) {
    for (const [attr, target] of Object.entries(I18N_ATTRIBUTES)) {
      for (const el of root.querySelectorAll<HTMLElement>(`[${attr}]`)) {
        const key = el.getAttribute(attr)!;
        const text = lookupString(key);
        if (text === undefined) {
          console.error(`文言が見つかりません：${key}`);
          continue;
        }
        if (target) el.setAttribute(target, text);
        else el.textContent = text;
      }
    }
  }
}
