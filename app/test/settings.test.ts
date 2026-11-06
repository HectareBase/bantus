// 設定の値をそろえる処理（src/shared/settings.ts）

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATEGORIES, COLOR_SWATCHES, DEFAULT_SETTINGS, DEFAULT_STATUS_COLORS, SETTING_DEFS, normalizeColor, normalizeSettings } from '../src/shared/settings';

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
    assert.deepEqual([s.mainArchiveMinutes, s.archive, s.archivedCards], [10, {}, {}]);
    assert.deepEqual([s.projectOrder, s.worktreeOrder, s.sessionOrder], ['fixed', 'fixed', 'fixed']);
    assert.equal(s.showUpdated, true);
  });
  it('選べる値だけを残す', () => {
    assert.equal(normalizeSettings({ mainArchiveMinutes: 0 }).mainArchiveMinutes, 0);
    assert.equal(normalizeSettings({ mainArchiveMinutes: 60 }).mainArchiveMinutes, 60);
    assert.equal(normalizeSettings({ mainArchiveMinutes: 5 }).mainArchiveMinutes, 10);
    assert.equal(normalizeSettings({ sessionOrder: 'recent' }).sessionOrder, 'recent');
    assert.equal(normalizeSettings({ projectOrder: 'name' }).projectOrder, 'fixed');
    assert.equal(normalizeSettings({ showUpdated: 'false' }).showUpdated, true);
  });
  it('前の版の項目（表示数、折りたたみ、番号）は読み捨てる', () => {
    const s = normalizeSettings({ groupLimit: 3, foldScope: 'worktree', showSeq: false }) as unknown as Record<string, unknown>;
    assert.deepEqual([s.groupLimit, s.foldScope, s.showSeq], [undefined, undefined, undefined]);
  });
});

describe('normalizeSettings のアーカイブの印', () => {
  it('セッションの ID の形と、決まった値だけを残す', () =>
    assert.deepEqual(normalizeSettings({ archive: { 'local_a-1': 'archived', local_b: 'shown', x: 'archived', local_c: 'yes' } }).archive, {
      'local_a-1': 'archived',
      local_b: 'shown',
    }));
  it('表でなければ空', () => {
    assert.deepEqual(normalizeSettings({ archive: ['local_a'] }).archive, {});
    assert.deepEqual(normalizeSettings({ archivedCards: 'x' }).archivedCards, {});
  });
  it('カードの目印は、制御文字のない文字列だけ', () =>
    assert.deepEqual(normalizeSettings({ archivedCards: { 'c:\\repo|wt': 'archived', 'a\nb': 'archived', '': 'shown' } }).archivedCards, {
      'c:\\repo|wt': 'archived',
    }));
  it('前の版の「常に表示」は、手で戻したものとして引き継ぐ（印があればそちらを残す）', () =>
    assert.deepEqual(normalizeSettings({ alwaysShow: ['local_a', 'local_b', 'x'], archive: { local_b: 'archived' } }).archive, {
      local_b: 'archived',
      local_a: 'shown',
    }));
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

describe('normalizeSettings の表示の拡大率', () => {
  it('なければ 100%', () => assert.equal(normalizeSettings({}).zoom, 100));
  it('80〜150 に収め、整数にする', () => {
    assert.equal(normalizeSettings({ zoom: 50 }).zoom, 80);
    assert.equal(normalizeSettings({ zoom: 300 }).zoom, 150);
    assert.equal(normalizeSettings({ zoom: 124.6 }).zoom, 125);
  });
  it('数でなければ既定値に戻す', () => assert.equal(normalizeSettings({ zoom: '125' }).zoom, 100));
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
  it('左の一覧は 全体 → 見た目 → カードの表示 → 通知 → 情報', () =>
    assert.deepEqual(CATEGORIES.map((c) => c.id), ['general', 'look', 'cards', 'notify', 'about']));
  it('全体は 位置 → 起動', () =>
    assert.deepEqual(layout('general'), [
      ['位置', ['edge', 'display']],
      ['起動', ['openAtLogin']],
    ]));
  it('見た目は 明るさ → ウィジェット → 状態の色', () =>
    assert.deepEqual(layout('look'), [
      ['明るさ', ['theme']],
      ['ウィジェット', ['backgroundOpacity', 'cardOpacity', 'headerShade', 'zoom']],
      ['状態の色', ['statusColors']],
    ]));
  it('カードの表示は アーカイブ → 並び順 → 行に出すもの', () =>
    assert.deepEqual(layout('cards'), [
      ['アーカイブ', ['mainArchiveMinutes']],
      ['並び順', ['projectOrder', 'worktreeOrder', 'sessionOrder']],
      ['行に出すもの', ['showUpdated']],
    ]));
  it('通知は 知らせるとき → 音 → Windows の通知', () =>
    assert.deepEqual(layout('notify'), [
      ['知らせるとき', ['notifyWaiting', 'notifyDone', 'muteWhenOpen']],
      ['音', ['sound', 'soundType', 'soundVolume']],
      ['Windows の通知', ['toast', 'flash']],
    ]));
});

describe('normalizeSettings の通知', () => {
  it('なければ、対応待ちだけを音と点滅で知らせ、トーストは出さない', () => {
    const s = normalizeSettings({});
    assert.deepEqual(
      [s.notifyWaiting, s.notifyDone, s.sound, s.soundType, s.soundVolume, s.toast, s.flash, s.muteWhenOpen],
      [true, false, true, 'chime', 60, false, true, true],
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

describe('normalizeSettings の theme', () => {
  it('なければ Windows に従う', () => assert.equal(normalizeSettings({}).theme, 'system'));
  it('選べる値を残す', () => {
    assert.equal(normalizeSettings({ theme: 'light' }).theme, 'light');
    assert.equal(normalizeSettings({ theme: 'dark' }).theme, 'dark');
  });
  it('知らない値は既定値に戻す', () => {
    for (const theme of ['Dark', 'auto', 1, null]) assert.equal(normalizeSettings({ theme }).theme, 'system');
  });
});

describe('normalizeSettings の statusColors', () => {
  it('なければ既定の色', () => assert.deepEqual(normalizeSettings({}).statusColors, DEFAULT_STATUS_COLORS));
  it('#rrggbb を小文字にそろえて残す', () =>
    assert.deepEqual(normalizeSettings({ statusColors: { busy: '#A371F7', waiting: '#e5534b', idle: '#26a69a', stopped: '#000000' } }).statusColors, {
      busy: '#a371f7', waiting: '#e5534b', idle: '#26a69a', stopped: '#000000',
    }));
  it('壊れた色・欠けた状態は、その状態だけ既定の色に戻す', () =>
    assert.deepEqual(normalizeSettings({ statusColors: { busy: 'red', waiting: '#e5534', idle: 123 } }).statusColors, DEFAULT_STATUS_COLORS));
  it('知らない状態（対応待ちの理由ごとの色など）は捨てる', () => {
    const colors = normalizeSettings({ statusColors: { waiting: '#e5534b', 'permission prompt': '#000000' } }).statusColors;
    assert.deepEqual(colors, { ...DEFAULT_STATUS_COLORS, waiting: '#e5534b' });
  });
  it('入れ物が表でなければ既定の色', () => {
    for (const statusColors of ['#000000', ['#000000'], null]) assert.deepEqual(normalizeSettings({ statusColors }).statusColors, DEFAULT_STATUS_COLORS);
  });
  it('既定の色と候補は #rrggbb', () => {
    for (const c of [...Object.values(DEFAULT_STATUS_COLORS), ...COLOR_SWATCHES]) assert.equal(normalizeColor(c), c);
  });
});

