// 常駐の補助プログラムとのやり取り（src/main/helper-line.ts）

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { SCRIPT as FOREGROUND_SCRIPT } from '../src/main/foreground';
import { COMMAND_LINE_LIMIT, createHelperLine, helperExeCandidates, powershellArgs } from '../src/main/helper-line';

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

describe('powershellArgs', () => {
  it('foreground.ts のスクリプトがコマンドラインの上限に収まる', () => {
    const length = ['powershell.exe', ...powershellArgs(FOREGROUND_SCRIPT)].join(' ').length;
    assert.ok(length < COMMAND_LINE_LIMIT, `${length} 文字`);
  });

  it('行頭の空白を削っても、foreground.ts のスクリプトが命令に答える', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
    const line = createHelperLine('foreground', FOREGROUND_SCRIPT, () => undefined);
    try {
      assert.equal(await line.ask('sink abc', 20000), '0');
      assert.equal(await line.ask('sink 0', 5000), '0');
      assert.equal(typeof (await line.ask('fg', 5000)), 'string');
    } finally {
      line.close();
    }
  });
});
