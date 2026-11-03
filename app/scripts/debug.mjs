// 開発用：見本データ（fixtures/*.json）でウィジェットを起動する。実データは読まない。
//   node scripts/debug.mjs [見本の名前] [--cycle 秒] [--screenshot 保存先.png] [--focus セレクター]
//   --focus：撮る前にその要素へフォーカスする（ツールチップは 〈保存先〉-tooltip.png に別に撮る）
// 見本の名前の既定は all-states。ファイルを書き換えると、すぐ表示に出る。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { cycle: { type: 'string' }, screenshot: { type: 'string' }, focus: { type: 'string' } },
});

const name = positionals[0] ?? 'all-states';
const fixture = existsSync(name) ? resolve(name) : join(root, 'fixtures', `${name}.json`);
if (!existsSync(fixture)) {
  console.error(`見本データが見つかりません：${fixture}`);
  process.exit(1);
}

const env = { ...process.env, WIDGET_FIXTURE: fixture };
if (values.cycle) env.WIDGET_FIXTURE_CYCLE = values.cycle;
if (values.screenshot) {
  env.WIDGET_SCREENSHOT = resolve(values.screenshot);
  mkdirSync(dirname(env.WIDGET_SCREENSHOT), { recursive: true });
}
if (values.focus) env.WIDGET_SCREENSHOT_FOCUS = values.focus;

const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron, ['.'], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
