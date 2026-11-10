// タイトルバーの CPU とメモリ（src/main/system-usage.ts と、画面の数字の作り方）

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cpuPercent, sampleCpu } from '../src/main/system-usage';
import { memGb, memPercent, percentLevel } from '../src/renderer/model';
import { normalizeSettings } from '../src/shared/settings';

const core = (user: number, idle: number) => ({ times: { user, nice: 0, sys: 0, idle, irq: 0 } });

describe('CPU の使用率', () => {
  it('すべてのコアの times を足す', () => assert.deepEqual(sampleCpu([core(10, 90), core(30, 70)]), { idle: 160, total: 200 }));
  it('前回との差から出す', () => {
    const prev = sampleCpu([core(10, 90), core(10, 90)]);
    const next = sampleCpu([core(40, 160), core(10, 190)]);
    // 差は全体 200、そのうち空き 170
    assert.equal(cpuPercent(prev, next), 15);
  });
  it('差がなければ 0', () => {
    const s = sampleCpu([core(10, 90)]);
    assert.equal(cpuPercent(s, s), 0);
  });
});

describe('メモリの数字', () => {
  it('割合は整数', () => assert.equal(memPercent(9.3 * 2 ** 30, 16 * 2 ** 30), 58));
  it('使用量は小数 1 桁、総量は整数の GB', () => assert.deepEqual(memGb(9.3 * 2 ** 30, 15.8 * 2 ** 30), { used: '9.3', total: '16' }));
});

describe('段階', () => {
  it('コンテキストと同じ境目', () => assert.deepEqual([49, 50, 74, 75].map(percentLevel), ['normal', 'high', 'high', 'full']));
});

describe('設定', () => {
  it('既定は出す', () => assert.equal(normalizeSettings({}).showSystemUsage, true));
  it('出さないを選べる', () => assert.equal(normalizeSettings({ showSystemUsage: false }).showSystemUsage, false));
});
