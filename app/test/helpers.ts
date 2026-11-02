// テストで使う小さな道具。偽のデータフォルダは一時フォルダに作り、本物の Claude のデータには触れない。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SessionView } from '../src/shared/types';

/** ビルド後は dist/test/test/ から動くので、3 つ上が app/ */
export const APP_ROOT = join(__dirname, '..', '..', '..');
export const FIXTURES = join(APP_ROOT, 'fixtures');

export function tempDir(): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'claude-helper-test-'));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

/** 文字列はそのまま書く（壊れた JSON を作るため） */
export function writeJson(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data));
}

let counter = 0;
/** テスト用の SessionView。指定しなかった項目は無難な値で埋める */
export function view(patch: Partial<SessionView> = {}): SessionView {
  counter++;
  return {
    id: `local_test-${counter}`,
    title: `session ${counter}`,
    repoKey: 'repo',
    repoName: 'repo',
    state: 'idle',
    lastActivityAt: 1_000_000,
    ...patch,
  };
}
