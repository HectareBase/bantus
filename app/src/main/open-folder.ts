// カードの作業フォルダを、エクスプローラーやターミナルで開く（右クリックのメニューから）

import { spawn } from 'node:child_process';
import { lstatSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cardKeyOf } from '../shared/card-key';
import type { SessionView } from '../shared/types';

/** カードの作業フォルダ。カードのセッションのうち、作業フォルダがわかる最初のもの。なければ undefined */
export function cardFolder(sessions: readonly SessionView[], key: string): string | undefined {
  return sessions.find((s) => s.workDir && cardKeyOf(s) === key)?.workDir;
}

/** フォルダがあるか（ワークツリーを消したあとは、もうない） */
export function isFolder(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** Windows Terminal（wt.exe）の場所。アプリ実行エイリアスとして入る（リパースポイントなので statSync は EACCES になる。lstatSync で確かめる） */
function windowsTerminal(): string | undefined {
  const base = process.env.LOCALAPPDATA;
  if (!base) return undefined;
  const wt = join(base, 'Microsoft', 'WindowsApps', 'wt.exe');
  try {
    lstatSync(wt);
    return wt;
  } catch {
    return undefined;
  }
}

/** 切り離して起動する。起動できなかったら fallback を呼ぶ */
function launch(command: string, args: string[], cwd: string, fallback?: () => void, verbatim = false) {
  try {
    const child = spawn(command, args, { cwd, detached: true, stdio: 'ignore', windowsVerbatimArguments: verbatim });
    child.on('error', (err) => {
      console.error(`${command} を起動できませんでした:`, err.message);
      fallback?.();
    });
    child.unref();
  } catch (err) {
    console.error(`${command} を起動できませんでした:`, err);
    fallback?.();
  }
}

/**
 * フォルダを作業フォルダにしてターミナルを開く。Windows Terminal があればそれで、なければ PowerShell の窓で。
 * PowerShell は start で新しい窓に出す（直接起動すると標準入力がなく、すぐ終わる）
 */
export function openTerminal(dir: string) {
  const powershell = () => launch('cmd.exe', ['/d', '/c', 'start "" powershell.exe -NoLogo'], dir, undefined, true);
  const wt = windowsTerminal();
  if (wt) launch(wt, ['-d', dir], dir, powershell);
  else powershell();
}
