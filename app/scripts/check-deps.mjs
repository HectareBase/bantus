// npm run build の前に呼ぶ（package.json の prebuild）。依存パッケージ（app/node_modules）が使えるかを確かめる。
// なければ、tsc が見つからないという分かりにくいエラーの代わりに、何をすればよいかを出して止まる。
//   ・ない、またはジャンクションの先が消えている：main では npm run setup、ワークツリーでも npm run setup
import { existsSync, lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const modules = join(appDir, 'node_modules');

let linked = false;
try {
  linked = lstatSync(modules).isSymbolicLink();
} catch {}

// 実際に使うもの（tsc と electron）まで見る。フォルダだけ残って中身が空のこともあるため
const need = ['typescript', 'electron'];
const missing = need.filter((n) => !existsSync(join(modules, n, 'package.json')));
if (!missing.length) process.exit(0);

console.error(`依存パッケージが見つかりません（${modules}）。足りないもの：${missing.join('、')}`);
if (linked) {
  console.error('ジャンクションの先（main の app/node_modules）が消えているようです。');
  console.error('main のチェックアウトで npm run setup を実行して、依存を入れ直してください。');
} else {
  console.error('一番上で npm run setup を実行してください（main では npm install、ワークツリーでは main へのジャンクションを作ります）。');
}
process.exit(1);
