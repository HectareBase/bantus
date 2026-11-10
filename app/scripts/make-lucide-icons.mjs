// 使う lucide のアイコンだけを src/renderer/icons.ts に書き出す。アイコンを足すときは NAMES に名前を足して npm run lucide-icons
// 画面の JS はそのままブラウザで読み込むので、lucide は実行時には使わず、ここでだけ使う（devDependencies）
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { icons } from 'lucide';

/** lucide.dev での名前 */
const NAMES = [
  'settings', 'chevron-right', 'pin', 'folder', 'house', 'git-branch', 'list', 'info',
  // 行とカードのアーカイブのトグル、一覧の起点の印、マージ済みのカード
  'archive', 'diamond', 'git-merge',
  // 一覧の起点の行き先（main のカードの一覧）
  'corner-down-right',
  // 設定の「通知」と、音の試聴
  'bell', 'volume-2',
  // 設定の「見た目」
  'palette',
  // 状態の印（renderer/model.ts の statusIconName）
  'shield', 'keyboard', 'app-window', 'circle-alert', 'message-square-more', 'circle-minus',
  // 処理中の印（アニメーション効果を「ひかえめ」にしたとき、回る輪の代わり）と、待機中でバックグラウンドの作業が動いている印
  'hourglass',
  // コミットされていない変更の内訳の印（renderer/model.ts の changeItems）
  'file-pen-line', 'file-plus', 'arrow-up', 'arrow-down',
  // 保留（docs/design/hold.md）：状態の印、乗せたときの切り替えの印、メモの枠
  'circle-pause', 'circle-play', 'pencil',
  // HTML ビューア（docs/design/html-viewer.md）：設定のカテゴリ、見出しのボタン
  'panel-bottom', 'rotate-cw', 'external-link', 'chevron-down', 'chevron-up',
];

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
