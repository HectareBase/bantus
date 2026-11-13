// 常駐の補助プログラムとのやり取り（src/main/helper-line.ts）

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createHelperLine, helperExeCandidates } from '../src/main/helper-line';

describe('helperExeCandidates', () => {
  it('インストール版の resources を先に、開発中の native/build をあとに探す', () => {
    const dirname = join('C:\app', 'dist', 'node', 'main');
    assert.deepEqual(helperExeCandidates('C:\Bantus\resources', dirname), [
      join('C:\Bantus\resources', 'bantus-helper.exe'),
      join('C:\app', 'native', 'build', 'bantus-helper.exe'),
    ]);
  });

  it('resources がなければ開発中の場所だけ', () => {
    assert.deepEqual(helperExeCandidates(undefined, join('C:\app', 'dist', 'node', 'main')), [join('C:\app', 'native', 'build', 'bantus-helper.exe')]);
  });
});

describe('createHelperLine', () => {
  it('exe を起動できなければ PowerShell に切り替え、答えていない命令を送り直す', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
    // exe の形をしていないファイル。spawn が失敗する
    const bad = join(mkdtempSync(join(tmpdir(), 'bantus-helper-')), 'broken.exe');
    writeFileSync(bad, 'not a program');
    const echo = 'while ($null -ne ($l = [Console]::In.ReadLine())) { [Console]::Out.WriteLine("ps:" + $l); [Console]::Out.Flush() }';
    const line = createHelperLine('foreground', echo, () => bad);
    try {
      const [a, b] = await Promise.all([line.ask('one', 20000), line.ask('two', 20000)]);
      assert.equal(a, 'ps:one');
      assert.equal(b, 'ps:two');
    } finally {
      line.close();
    }
  });
});
