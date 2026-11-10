// 画面の文言が shared/strings/ja.ts にまとまっていることを確かめる（docs/strings.md）。
// - src/ のうち strings/ 以外で、コメントでないところに日本語（ひらがな、カタカナ、漢字）があれば失敗する
// - HTML の data-i18n などに書いたキーが、ja.ts の文字列の文言を指していること

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { I18N_ATTRIBUTES, lookupString } from '../src/shared/strings/lookup';
import { APP_ROOT } from './helpers';

const SRC = join(APP_ROOT, 'src');
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

/**
 * 日本語を書いてよい所。画面に出ない文字（ログ、投げるだけの例外）に限る。
 * file は src/ からの相対パス、line はその行に当てはまる正規表現
 */
const ALLOWED: { file: string; line: RegExp; reason: string }[] = [
  { file: 'main/main.ts', line: /console\.(log|error)\(/, reason: 'ログ' },
  { file: 'main/self-update.ts', line: /console\.(log|error)\(/, reason: 'ログ' },
  { file: 'main/open-folder.ts', line: /console\.error\(/, reason: 'ログ' },
  { file: 'main/appbar.ts', line: /console\.error\(/, reason: 'ログ' },
  { file: 'main/powershell-line.ts', line: /console\.error\(/, reason: 'ログ' },
  { file: 'main/self-update.ts', line: /reject\(new Error\(`npm run build/, reason: 'ログに出すだけの例外（画面には出さない）' },
  { file: 'renderer/strings.ts', line: /console\.error\(/, reason: 'ログ' },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** TS と CSS のコメントを、改行だけ残して空白にする。文字列（'、"、`）の中はそのまま */
function stripScriptComments(src: string, css: boolean): string {
  let out = '';
  let i = 0;
  /** 今いる所。テンプレートリテラルの ${} の入れ子を数える */
  const stack: ('code' | '`')[] = ['code'];
  let braces: number[] = [0];
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  while (i < src.length) {
    const ch = src[i]!;
    const top = stack[stack.length - 1];
    if (top === '`') {
      if (ch === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (ch === '`') { stack.pop(); out += ch; i++; continue; }
      if (ch === '$' && src[i + 1] === '{') { stack.push('code'); braces.push(0); out += '${'; i += 2; continue; }
      out += ch; i++; continue;
    }
    if (!css && ch === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      out += blank(src.slice(i, stop)); i = stop; continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += blank(src.slice(i, stop)); i = stop; continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (!css && ch === '`') { stack.push('`'); out += ch; i++; continue; }
    if (!css && stack.length > 1) {
      if (ch === '{') braces[braces.length - 1]!++;
      if (ch === '}') {
        if (braces[braces.length - 1] === 0) { stack.pop(); braces = braces.slice(0, -1); out += ch; i++; continue; }
        braces[braces.length - 1]!--;
      }
    }
    out += ch; i++;
  }
  return out;
}

function stripHtmlComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
}

function codeOf(path: string): string {
  const src = readFileSync(path, 'utf8');
  switch (extname(path)) {
    case '.ts': return stripScriptComments(src, false);
    case '.css': return stripScriptComments(src, true);
    case '.html': return stripHtmlComments(src);
    default: return src;
  }
}

describe('画面の文言は shared/strings/ にだけ書く', () => {
  const files = walk(SRC)
    .filter((p) => /\.(ts|html|css)$/.test(p))
    .map((p) => ({ path: p, rel: relative(SRC, p).replaceAll('\\', '/') }))
    .filter((f) => !f.rel.startsWith('shared/strings/'));

  it('コメントの外に日本語がない', () => {
    const found: string[] = [];
    for (const f of files) {
      const original = readFileSync(f.path, 'utf8').split(/\r?\n/);
      codeOf(f.path).split(/\r?\n/).forEach((code, n) => {
        if (!JAPANESE.test(code)) return;
        const line = original[n] ?? '';
        if (ALLOWED.some((a) => a.file === f.rel && a.line.test(line))) return;
        found.push(`src/${f.rel}:${n + 1}: ${line.trim()}`);
      });
    }
    assert.deepEqual(found, [], '画面の文言は src/shared/strings/ja.ts に書いてください（ログなら test/strings.test.ts の ALLOWED に足す）');
  });

  it('コメントの判定（見本）', () => {
    const code = stripScriptComments("const a = 'x'; // 日本語\n/* 日本語 */ const b = `${c /* 日本語 */}y`;\nconst d = '日本語';", false);
    assert.deepEqual(code.split('\n').map((l) => JAPANESE.test(l)), [false, false, true]);
  });
});

describe('HTML の文言のキー', () => {
  const htmlFiles = walk(SRC).filter((p) => p.endsWith('.html'));
  for (const path of htmlFiles) {
    it(relative(SRC, path).replaceAll('\\', '/'), () => {
      const html = readFileSync(path, 'utf8');
      for (const attr of Object.keys(I18N_ATTRIBUTES)) {
        for (const m of html.matchAll(new RegExp(`\\s${attr}="([^"]*)"`, 'g'))) {
          assert.equal(typeof lookupString(m[1]!), 'string', `${attr}="${m[1]}" が ja.ts にありません`);
        }
      }
    });
  }
});
