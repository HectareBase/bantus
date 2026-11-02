// 使う lucide のアイコンだけを src/renderer/icons.ts に書き出す。アイコンを足すときは NAMES に名前を足して npm run lucide-icons
// 画面の JS はそのままブラウザで読み込むので、lucide は実行時には使わず、ここでだけ使う（devDependencies）
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { icons } from 'lucide';

/** lucide.dev での名前 */
const NAMES = ['settings', 'chevron-right', 'x', 'folder', 'house', 'git-branch', 'panel-right', 'info'];

const pascal = (name) => name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());

const lines = NAMES.map((name) => {
  const node = icons[pascal(name)];
  if (!node) throw new Error(`lucide にないアイコン：${name}`);
  return `  '${name}': ${JSON.stringify(node)},`;
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'node_modules', 'lucide', 'package.json'), 'utf8'));
writeFileSync(
  join(root, 'src', 'renderer', 'icons.ts'),
  `// scripts/make-lucide-icons.mjs が作るファイル。手で直さない（npm run lucide-icons）
// Lucide ${version} (https://lucide.dev) のアイコン。ISC License, Copyright (c) Lucide Contributors

/** SVG の子要素の並び（viewBox は 0 0 24 24） */
export type IconNode = [tag: string, attrs: Record<string, string>][];

export const ICONS = {
${lines.join('\n')}
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;
`,
);
console.log(`src/renderer/icons.ts に ${NAMES.length} 個のアイコンを書き出した`);
