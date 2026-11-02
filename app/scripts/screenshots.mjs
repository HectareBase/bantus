// 開発用：fixtures/ のすべての見本データで画面を撮り、dist/screenshots/<名前>.png に保存する（停止中も開いた状態）
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'screenshots');
for (const file of readdirSync(join(root, 'fixtures')).filter((f) => f.endsWith('.json'))) {
  const name = file.replace(/\.json$/, '');
  const png = join(out, `${name}.png`);
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'debug.mjs'), name, '--screenshot', png], { stdio: 'inherit' });
  console.log(r.status === 0 ? `保存しました：${png}` : `失敗しました：${name}`);
}
