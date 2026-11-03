// 設定の値をそろえる処理（src/shared/settings.ts）

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings';

describe('normalizeSettings の settingsWindow', () => {
  it('なければ入れない', () => assert.equal(normalizeSettings({}).settingsWindow, undefined));
  it('4 つの数がそろっていれば整数にして残す', () =>
    assert.deepEqual(normalizeSettings({ settingsWindow: { x: -10.4, y: 20, width: 880.6, height: 640 } }).settingsWindow, {
      x: -10, y: 20, width: 881, height: 640,
    }));
  it('欠けている・数でない・大きさが 0 以下なら捨てる', () => {
    for (const settingsWindow of [{ x: 0, y: 0, width: 100 }, { x: 0, y: 0, width: '100', height: 100 }, { x: 0, y: 0, width: 0, height: 100 }, 'x']) {
      assert.equal(normalizeSettings({ settingsWindow }).settingsWindow, undefined);
    }
  });
  it('ほかの項目には影響しない', () =>
    assert.deepEqual(normalizeSettings({ settingsWindow: { x: 1, y: 2, width: 3, height: 4 } }), {
      ...DEFAULT_SETTINGS, settingsWindow: { x: 1, y: 2, width: 3, height: 4 },
    }));
});

describe('normalizeSettings の pinned', () => {
  it('なければ固定する', () => assert.equal(normalizeSettings({}).pinned, true));
  it('false を残す', () => assert.equal(normalizeSettings({ pinned: false }).pinned, false));
  it('真偽値でなければ既定値に戻す', () => assert.equal(normalizeSettings({ pinned: 'false' }).pinned, true));
});
