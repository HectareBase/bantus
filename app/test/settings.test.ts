// 設定の値をそろえる処理（src/shared/settings.ts）

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATEGORIES, DEFAULT_SETTINGS, SETTING_DEFS, normalizeSettings } from '../src/shared/settings';

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

describe('normalizeSettings の openAtLogin', () => {
  it('なければ開かない', () => assert.equal(normalizeSettings({}).openAtLogin, false));
  it('true を残す', () => assert.equal(normalizeSettings({ openAtLogin: true }).openAtLogin, true));
  it('真偽値でなければ既定値に戻す', () => assert.equal(normalizeSettings({ openAtLogin: 'true' }).openAtLogin, false));
  it('全体のカテゴリに、インストール版だけの項目として出す', () => {
    const def = SETTING_DEFS.find((d) => d.key === 'openAtLogin');
    assert.deepEqual([def?.category, def?.packagedOnly], ['general', true]);
  });
});

describe('normalizeSettings の一覧の項目', () => {
  it('なければ既定値', () => {
    const s = normalizeSettings({});
    assert.deepEqual([s.groupLimit, s.foldScope, s.alwaysShow], [5, 'repo', []]);
    assert.deepEqual([s.projectOrder, s.worktreeOrder, s.sessionOrder], ['fixed', 'fixed', 'fixed']);
    assert.deepEqual([s.showSeq, s.showUpdated], [true, true]);
  });
  it('選べる値だけを残す', () => {
    assert.equal(normalizeSettings({ groupLimit: 0 }).groupLimit, 0);
    assert.equal(normalizeSettings({ groupLimit: 4 }).groupLimit, 5);
    assert.equal(normalizeSettings({ groupLimit: '3' }).groupLimit, 5);
    assert.equal(normalizeSettings({ foldScope: 'worktree' }).foldScope, 'worktree');
    assert.equal(normalizeSettings({ foldScope: 'x' }).foldScope, 'repo');
    assert.equal(normalizeSettings({ sessionOrder: 'recent' }).sessionOrder, 'recent');
    assert.equal(normalizeSettings({ projectOrder: 'name' }).projectOrder, 'fixed');
    assert.equal(normalizeSettings({ showSeq: false }).showSeq, false);
    assert.equal(normalizeSettings({ showUpdated: 'false' }).showUpdated, true);
  });
  it('常に表示は、セッションの ID の形をした文字列だけを、重ねずに残す', () =>
    assert.deepEqual(normalizeSettings({ alwaysShow: ['local_a-1', 'local_a-1', 'x', 3, 'local_b'] }).alwaysShow, ['local_a-1', 'local_b']));
  it('配列でなければ空', () => assert.deepEqual(normalizeSettings({ alwaysShow: 'local_a' }).alwaysShow, []));
});

describe('normalizeSettings の見出しの濃さ', () => {
  it('なければ 5%', () => assert.equal(normalizeSettings({}).headerShade, 5));
  it('0〜20 に収め、整数にする', () => {
    assert.equal(normalizeSettings({ headerShade: 0 }).headerShade, 0);
    assert.equal(normalizeSettings({ headerShade: 50 }).headerShade, 20);
    assert.equal(normalizeSettings({ headerShade: 7.6 }).headerShade, 8);
  });
  it('数でなければ既定値に戻す', () => assert.equal(normalizeSettings({ headerShade: '10' }).headerShade, 5));
});

describe('設定画面のカテゴリ', () => {
  const layout = (id: string) => {
    const out: [string, string[]][] = [];
    for (const d of SETTING_DEFS.filter((d) => d.category === id)) {
      if (out.at(-1)?.[0] !== d.group) out.push([d.group, []]);
      out.at(-1)![1].push(d.key);
    }
    return out;
  };
  it('左の一覧は 全体 → カードの表示 → 通知 → 情報', () => assert.deepEqual(CATEGORIES.map((c) => c.id), ['general', 'cards', 'notify', 'about']));
  it('全体は 位置 → 見た目 → 起動', () =>
    assert.deepEqual(layout('general'), [
      ['位置', ['edge', 'display']],
      ['見た目', ['backgroundOpacity', 'cardOpacity', 'headerShade']],
      ['起動', ['openAtLogin']],
    ]));
  it('カードの表示は 一覧 → 並び順 → 行に出すもの', () =>
    assert.deepEqual(layout('cards'), [
      ['一覧', ['groupLimit', 'foldScope']],
      ['並び順', ['projectOrder', 'worktreeOrder', 'sessionOrder']],
      ['行に出すもの', ['showSeq', 'showUpdated']],
    ]));
  it('通知は 知らせるとき → 音 → Windows の通知', () =>
    assert.deepEqual(layout('notify'), [
      ['知らせるとき', ['notifyWaiting', 'notifyDone', 'muteWhenOpen']],
      ['音', ['sound', 'soundType', 'soundVolume']],
      ['Windows の通知', ['toast']],
    ]));
});

describe('normalizeSettings の通知', () => {
  it('なければ、対応待ちだけを音で知らせ、トーストは出さない', () => {
    const s = normalizeSettings({});
    assert.deepEqual(
      [s.notifyWaiting, s.notifyDone, s.sound, s.soundType, s.soundVolume, s.toast, s.muteWhenOpen],
      [true, false, true, 'chime', 60, false, true],
    );
  });
  it('選べる値だけを残す', () => {
    const s = normalizeSettings({ notifyDone: true, soundType: 'bell', toast: true, muteWhenOpen: false });
    assert.deepEqual([s.notifyDone, s.soundType, s.toast, s.muteWhenOpen], [true, 'bell', true, false]);
    assert.equal(normalizeSettings({ soundType: 'siren' }).soundType, 'chime');
    assert.equal(normalizeSettings({ sound: 'false' }).sound, true);
  });
  it('音量は 0〜100 に収め、整数にする', () => {
    assert.equal(normalizeSettings({ soundVolume: 150 }).soundVolume, 100);
    assert.equal(normalizeSettings({ soundVolume: -3 }).soundVolume, 0);
    assert.equal(normalizeSettings({ soundVolume: 33.6 }).soundVolume, 34);
  });
  it('音の種類だけに試聴のボタンを付ける', () =>
    assert.deepEqual(SETTING_DEFS.filter((d) => d.type === 'segmented' && d.preview).map((d) => d.key), ['soundType']));
});
