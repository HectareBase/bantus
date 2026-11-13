// 常駐の PowerShell の代わりに、C で書いた小さなプログラム（native/bantus-helper.c）を起動する試作の切り替え。
// 環境変数 BANTUS_HELPER=native で、ビルドした exe（npm run build:native）があればそちらを使う。なければ今までどおり PowerShell。
// 命令と答えの形はどちらも同じなので、呼ぶ側は起動するものが変わるだけ。docs/design/native-helper.md

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** foreground：foreground.ts の命令。appbar：appbar.ts の命令 */
export type HelperMode = 'foreground' | 'appbar';

/** dist/node/main から見た app/native/build/bantus-helper.exe */
const EXE = join(__dirname, '..', '..', '..', 'native', 'build', 'bantus-helper.exe');

/** 起動するプログラムと引数。PowerShell なら script を -EncodedCommand で渡す */
export function helperCommand(mode: HelperMode, script: string): { command: string; args: string[] } {
  if (process.env.BANTUS_HELPER === 'native' && existsSync(EXE)) {
    return { command: EXE, args: mode === 'appbar' ? ['appbar'] : [] };
  }
  // -EncodedCommand（UTF-16LE の base64）なら、引数の引用符を気にしなくてよい
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return { command: 'powershell.exe', args: ['-NoProfile', '-NoLogo', '-NonInteractive', '-EncodedCommand', encoded] };
}
