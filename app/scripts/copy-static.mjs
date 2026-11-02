// TypeScript 以外の画面のファイル（HTML、CSS）を dist にコピーする
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'src', 'renderer');
const to = join(root, 'dist', 'web', 'renderer');
mkdirSync(to, { recursive: true });
for (const name of readdirSync(from)) {
  if (/\.(html|css)$/.test(name)) cpSync(join(from, name), join(to, name));
}
// タイトルバーに出すアイコン（18px なので、太くした小さいサイズ用を使う）
cpSync(join(root, 'assets', 'icon-small.svg'), join(to, 'icon.svg'));
