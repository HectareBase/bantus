// 一番上の npm run setup から呼ぶ。依存パッケージを用意する。
//   main のチェックアウト：npm --prefix app install（今までどおり）
//   ワークツリー：main のチェックアウトの app/node_modules へのジャンクションを作る（管理者の権限はいらない）
// app/node_modules がもうあれば何もしない。依存を変えるときは、ジャンクションを外して npm install する。
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const link = join(appDir, 'node_modules');

/** git rev-parse の結果（絶対パス）。git がなければ undefined */
function gitPath(flag) {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', flag], { cwd: appDir, encoding: 'utf8' });
  return r.status === 0 ? resolve(r.stdout.trim()) : undefined;
}

function install() {
  const r = spawnSync('npm', ['install'], { cwd: appDir, stdio: 'inherit', shell: true });
  process.exit(r.status ?? 1);
}

const gitDir = gitPath('--git-dir');
const commonDir = gitPath('--git-common-dir');
// ワークツリーでは、git のフォルダ（.git/worktrees/<名前>）と共通のフォルダ（.git）が違う
if (!gitDir || !commonDir || gitDir.toLowerCase() === commonDir.toLowerCase()) install();

let exists = false;
try {
  lstatSync(link);
  exists = true;
} catch {}
if (exists) {
  console.log(`app/node_modules はもうあります（${link}）。何もしません`);
  process.exit(0);
}

// 共通のフォルダ（<main>/.git）の親が main のチェックアウト
const target = join(dirname(commonDir), 'app', 'node_modules');
if (!existsSync(target)) {
  console.error(`main のチェックアウトに app/node_modules がありません（${target}）。先に main で npm run setup を実行してください`);
  process.exit(1);
}
symlinkSync(target, link, 'junction');
console.log(`ジャンクションを作りました：${link} → ${target}`);
console.log('依存を変える作業では、ジャンクションを外して（cmd /c rmdir app\\node_modules）から npm install してください');
