// 常駐の小さなプログラム（native/bantus-helper.c）を MSVC でビルドし、native/build/bantus-helper.exe に置く。
// Visual Studio（C++ のワークロード）が要る。場所は vswhere で探す。docs/design/native-helper.md
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'native', 'bantus-helper.c');
const outDir = join(root, 'native', 'build');
const vswhere = join(process.env['ProgramFiles(x86)'] ?? 'C:\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');

if (process.platform !== 'win32') {
  console.log('Windows でないので、ビルドしません');
  process.exit(0);
}
if (!existsSync(vswhere)) {
  console.error('Visual Studio が見つかりません（vswhere.exe がない）');
  process.exit(1);
}
const found = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' });
const vs = found.stdout.trim().split(/\r?\n/)[0];
const vcvars = vs && join(vs, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
if (!vcvars || !existsSync(vcvars)) {
  console.error('MSVC（C++ のビルドツール）が見つかりません');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
// /MT：C のランタイムを exe に入れる（VC++ の再頒布パッケージを要らなくする）。/O1：大きさを優先
const cl = [
  'cl', '/nologo', '/O1', '/MT', '/W4', '/utf-8', '/GS', '/guard:cf',
  `"${src}"`, `/Fe"${join(outDir, 'bantus-helper.exe')}"`, `/Fo"${join(outDir, 'bantus-helper.obj')}"`,
  '/link', '/SUBSYSTEM:WINDOWS', '/ENTRY:mainCRTStartup', '/DYNAMICBASE', '/NXCOMPAT', '/guard:cf',
].join(' ');
const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"call "${vcvars}" >nul 2>nul && ${cl}"`], { stdio: 'inherit', windowsVerbatimArguments: true });
process.exit(r.status ?? 1);
