// 常駐の補助プログラム（native/bantus-helper.c）を MSVC でビルドし、native/build/bantus-helper.exe に置く。docs/design/native-helper.md
// - Visual Studio（C++ のビルドツール）が要る。場所は vswhere で探す
// - --if-available：MSVC がなければ何もせずに終わる（npm run build から呼ぶとき。exe がなければ、アプリは PowerShell で動く）
// - ソースとこのスクリプトより exe が新しければ、ビルドしない
// - 動いている exe（Bantus が使っている）は上書きできないので、別名でビルドしてから名前を入れ替える。古いほうは .old にして、次のビルドで消す
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ifAvailable = process.argv.includes('--if-available');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'native', 'bantus-helper.c');
const outDir = join(root, 'native', 'build');
const exe = join(outDir, 'bantus-helper.exe');
const fresh = join(outDir, 'bantus-helper.new.exe');

function skip(message) {
  if (!ifAvailable) {
    console.error(message);
    process.exit(1);
  }
  console.log(`${message}。補助プログラムはビルドしません（アプリは PowerShell で動きます）`);
  process.exit(0);
}

if (process.platform !== 'win32') skip('Windows ではありません');
const mtime = (p) => (existsSync(p) ? statSync(p).mtimeMs : 0);
if (mtime(exe) > Math.max(mtime(src), mtime(fileURLToPath(import.meta.url)))) process.exit(0);

const vswhere = join(process.env['ProgramFiles(x86)'] ?? 'C:\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
if (!existsSync(vswhere)) skip('Visual Studio が見つかりません（vswhere.exe がない）');
const found = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' });
const vs = found.stdout?.trim().split(/\r?\n/)[0];
const vcvars = vs ? join(vs, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat') : '';
if (!vcvars || !existsSync(vcvars)) skip('MSVC（C++ のビルドツール）が見つかりません');

mkdirSync(outDir, { recursive: true });
for (const name of readdirSync(outDir)) {
  if (/\.old\d*\.exe$/.test(name)) rmSync(join(outDir, name), { force: true });
}
// /MT：C のランタイムを exe に入れる（VC++ の再頒布パッケージを要らなくする）。/O1：大きさを優先
// /SUBSYSTEM:WINDOWS：コンソールのないプログラムにする（conhost.exe を付けない）
const cl = [
  'cl', '/nologo', '/O1', '/MT', '/W4', '/WX', '/utf-8', '/GS', '/guard:cf',
  `"${src}"`, `/Fe"${fresh}"`, `/Fo"${join(outDir, 'bantus-helper.obj')}"`,
  '/link', '/SUBSYSTEM:WINDOWS', '/ENTRY:mainCRTStartup', '/DYNAMICBASE', '/NXCOMPAT', '/guard:cf',
].join(' ');
const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"call "${vcvars}" >nul 2>nul && ${cl}"`], { stdio: 'inherit', windowsVerbatimArguments: true });
if (r.status !== 0) process.exit(r.status ?? 1);
if (existsSync(exe)) {
  // 消せなければ（動いている）、名前だけ変えて退かす
  try {
    rmSync(exe);
  } catch {
    let n = 0;
    while (existsSync(join(outDir, `bantus-helper.old${n}.exe`))) n++;
    renameSync(exe, join(outDir, `bantus-helper.old${n}.exe`));
  }
}
renameSync(fresh, exe);
console.log(`補助プログラムをビルドしました：${exe}`);
