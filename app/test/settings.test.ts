// 設定の値をそろえる処理（src/shared/settings.ts）

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CATEGORIES, COLOR_STATES, COLOR_SWATCHES, DEFAULT_SETTINGS, DEFAULT_STATUS_COLORS, HOLD_NOTE_MAX, SETTING_DEFS, WIDTH_MIN, clampWidth, highlightScale, normalizeColor, normalizeNote, normalizeSettings,
} from '../src/shared/settings';

describe('git の設定', () => {
  it('既定は、取得しない・10 分・印を出す・未追跡を数える', () => {
    const s = normalizeSettings({});
    assert.deepEqual([s.gitFetch, s.gitFetchMinutes, s.showChanges, s.countUntracked], [false, 10, true, true]);
  });
  it('間隔は 5 / 10 / 30 分だけ。ほかは既定に戻す', () => {
    assert.equal(normalizeSettings({ gitFetchMinutes: 5 }).gitFetchMinutes, 5);
    assert.equal(normalizeSettings({ gitFetchMinutes: 30 }).gitFetchMinutes, 30);
    assert.equal(normalizeSettings({ gitFetchMinutes: 1 }).gitFetchMinutes, 10);
  });
  it('間隔と「今すぐ取得」は、取得がオフのとき押せない', () =>
    assert.deepEqual(SETTING_DEFS.filter((d) => d.enabledBy === 'gitFetch').map((d) => d.key), ['gitFetchMinutes', 'gitFetchNow']));
  it('表示のかたちはベゼルとフロートの 2 択', () => {
    const def = SETTING_DEFS.find((d) => d.key === 'island');
    assert.equal(def?.type, 'segmented');
    assert.deepEqual(def?.type === 'segmented' && def.options.map((o) => o.value), [true, false]);
  });
  it('ベゼルのときだけ角の丸みと縁の太さを出し、フロートのときだけ背景とカードの不透明度を出す', () => {
    const shown = (value: boolean) => SETTING_DEFS.filter((d) => d.shownWhen?.key === 'island' && d.shownWhen.value === value).map((d) => d.key);
    assert.deepEqual(shown(true), ['islandRadius', 'islandLine']);
    assert.deepEqual(shown(false), ['backgroundOpacity', 'cardOpacity']);
  });
  it('角の丸みと縁の太さは範囲に収める', () => {
    const s = normalizeSettings({ islandRadius: 100, islandLine: 0 });
    assert.deepEqual([s.islandRadius, s.islandLine], [32, 1]);
    assert.deepEqual([DEFAULT_SETTINGS.islandRadius, DEFAULT_SETTINGS.islandLine], [12, 1]);
  });
  it('ボタンは設定の値を持たない', () => assert.equal('gitFetchNow' in normalizeSettings({ gitFetchNow: true }), false));
});

describe('ウィジェットの幅', () => {
  it('保存された幅は 480px を超えても残す', () => assert.equal(normalizeSettings({ width: 900 }).width, 900));
  it('保存された幅の行き過ぎと小さすぎは切る', () => {
    assert.equal(normalizeSettings({ width: 100000 }).width, 3840);
    assert.equal(normalizeSettings({ width: 10 }).width, WIDTH_MIN);
  });
  it('ドラッグの幅は作業領域の半分で止める', () => {
    assert.equal(clampWidth(1500, 2560), 1280);
    assert.equal(clampWidth(700.4, 2560), 700);
    assert.equal(clampWidth(50, 2560), WIDTH_MIN);
  });
  it('作業領域が狭いときは半分を優先する', () => assert.equal(clampWidth(300, 300), 150));
});

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
  it('一般のカテゴリに、インストール版だけの項目として出す', () => {
    const def = SETTING_DEFS.find((d) => d.key === 'openAtLogin');
    assert.deepEqual([def?.category, def?.packagedOnly], ['general', true]);
  });
});

describe('normalizeSettings の hardwareAcceleration', () => {
  it('なければ GPU を使わない', () => assert.equal(normalizeSettings({}).hardwareAcceleration, false));
  it('true を残す', () => assert.equal(normalizeSettings({ hardwareAcceleration: true }).hardwareAcceleration, true));
  it('真偽値でなければ既定値に戻す', () => assert.equal(normalizeSettings({ hardwareAcceleration: 'true' }).hardwareAcceleration, false));
  it('一般のカテゴリに、トグルスイッチで出す', () => {
    const def = SETTING_DEFS.find((d) => d.key === 'hardwareAcceleration');
    assert.equal(def?.category, 'general');
    assert.equal(def?.type, 'toggle');
  });
});

describe('normalizeSettings の一覧の項目', () => {
  it('なければ既定値', () => {
    const s = normalizeSettings({});
    assert.deepEqual([s.mainArchiveMinutes, s.archive, s.archivedCards], [10, {}, {}]);
    assert.deepEqual([s.projectOrder, s.worktreeOrder, s.sessionOrder], ['fixed', 'fixed', 'fixed']);
    assert.equal(s.showUpdated, true);
    assert.equal(s.showState, true);
    assert.equal(s.showContext, true);
  });
  it('選べる値だけを残す', () => {
    assert.equal(normalizeSettings({ mainArchiveMinutes: 0 }).mainArchiveMinutes, 0);
    assert.equal(normalizeSettings({ mainArchiveMinutes: 60 }).mainArchiveMinutes, 60);
    assert.equal(normalizeSettings({ mainArchiveMinutes: 5 }).mainArchiveMinutes, 10);
    assert.equal(normalizeSettings({ sessionOrder: 'recent' }).sessionOrder, 'recent');
    assert.equal(normalizeSettings({ projectOrder: 'name' }).projectOrder, 'fixed');
    assert.equal(normalizeSettings({ showUpdated: 'false' }).showUpdated, true);
    assert.equal(normalizeSettings({ showState: false }).showState, false);
    assert.equal(normalizeSettings({ showContext: false }).showContext, false);
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

describe('normalizeSettings の開いている行の濃さ', () => {
  it('なければ 50% で、倍率は 1（以前と同じ見た目）', () => {
    assert.equal(normalizeSettings({}).activeHighlight, 50);
    assert.equal(highlightScale(50), 1);
  });
  it('0〜100 に収め、整数にする', () => {
    assert.equal(normalizeSettings({ activeHighlight: 0 }).activeHighlight, 0);
    assert.equal(normalizeSettings({ activeHighlight: 150 }).activeHighlight, 100);
    assert.equal(normalizeSettings({ activeHighlight: 32.6 }).activeHighlight, 33);
  });
  it('前の版の薄い・標準・濃いは、同じ倍率の濃さに置き換える', () => {
    const scale = (v: string) => highlightScale(normalizeSettings({ activeHighlight: v }).activeHighlight);
    assert.deepEqual([scale('subtle'), scale('normal'), scale('strong')], [0.5, 1, 2]);
  });
  it('知らない値は 50% に戻す', () => {
    assert.equal(normalizeSettings({ activeHighlight: 'max' }).activeHighlight, 50);
    assert.equal(normalizeSettings({ activeHighlight: 'toString' }).activeHighlight, 50);
  });
  it('0% で強調しない', () => assert.equal(highlightScale(0), 0));
});

describe('normalizeSettings のアニメーション効果', () => {
  it('なければ標準（以前と同じ見た目）', () => assert.equal(normalizeSettings({}).motion, 'full'));
  it('ひかえめを残す', () => assert.equal(normalizeSettings({ motion: 'subtle' }).motion, 'subtle'));
  it('知らない値は標準に戻す', () => assert.equal(normalizeSettings({ motion: 'off' }).motion, 'full'));
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

describe('normalizeSettings の行の上下の余白', () => {
  it('なければ 4px（今までの見た目）', () => assert.equal(normalizeSettings({}).rowPadding, 4));
  it('0〜12 に収め、整数にする', () => {
    assert.equal(normalizeSettings({ rowPadding: 0 }).rowPadding, 0);
    assert.equal(normalizeSettings({ rowPadding: -3 }).rowPadding, 0);
    assert.equal(normalizeSettings({ rowPadding: 40 }).rowPadding, 12);
    assert.equal(normalizeSettings({ rowPadding: 6.6 }).rowPadding, 7);
  });
  it('数でなければ既定値に戻す', () => assert.equal(normalizeSettings({ rowPadding: '8' }).rowPadding, 4));
});

describe('設定画面のトグルスイッチ', () => {
  it('既定値がオンかオフの項目は、トグルスイッチで出す（HTML の高さの 自動／手動 と、表示のかたちの ベゼル／フロート は選択肢のまま）', () => {
    for (const d of SETTING_DEFS) {
      if (d.type === 'action' || d.key === 'viewerAutoHeight' || d.key === 'island') continue;
      if (typeof DEFAULT_SETTINGS[d.key] === 'boolean') assert.equal(d.type, 'toggle', d.key);
    }
  });
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
  it('左の一覧は 一般 → デザイン → カードの表示 → 通知 → git → HTML ビューア → このアプリについて', () =>
    assert.deepEqual(CATEGORIES.map((c) => c.id), ['general', 'look', 'cards', 'notify', 'git', 'viewer', 'about']));
  it('項目の並びもカテゴリの順', () => {
    const order = CATEGORIES.map((c) => c.id);
    const seen = SETTING_DEFS.map((d) => order.indexOf(d.category));
    assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
  });
  it('git は リモートの取得 → 変更の数', () =>
    assert.deepEqual(layout('git'), [
      ['リモートの取得', ['gitFetch', 'gitFetchMinutes', 'gitFetchNow']],
      ['変更の数', ['showChanges', 'countUntracked']],
    ]));
  it('git のアイコンは git-branch', () => assert.equal(CATEGORIES.find((c) => c.id === 'git')?.icon, 'git-branch'));
  it('一般は 位置 → ツールチップ → タイトルバー → 起動 → パフォーマンス', () =>
    assert.deepEqual(layout('general'), [
      ['位置', ['edge', 'display']],
      ['ツールチップ', ['tooltipDelayMs']],
      ['タイトルバー', ['showSystemUsage']],
      ['起動', ['openAtLogin']],
      ['パフォーマンス', ['hardwareAcceleration']],
    ]));
  it('デザインは テーマ → ウィジェット → 状態の色', () =>
    assert.deepEqual(layout('look'), [
      ['テーマ', ['theme']],
      ['ウィジェット', ['island', 'islandRadius', 'islandLine', 'backgroundOpacity', 'cardOpacity', 'headerShade', 'activeHighlight', 'zoom']],
      ['状態の色', ['motion', 'statusColors']],
    ]));
  it('カードの表示は アーカイブ → 並び順 → 行の大きさ → 行に表示する項目', () =>
    assert.deepEqual(layout('cards'), [
      ['アーカイブ', ['mainArchiveMinutes']],
      ['並び順', ['projectOrder', 'worktreeOrder', 'sessionOrder']],
      ['行の大きさ', ['rowPadding']],
      ['行に表示する項目', ['showUpdated', 'showState', 'showContext']],
    ]));
  it('通知は 通知するタイミング → 音 → Windows の通知', () =>
    assert.deepEqual(layout('notify'), [
      ['通知するタイミング', ['notifyWaiting', 'notifyDone', 'muteWhenOpen']],
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
      busy: '#a371f7', waiting: '#e5534b', idle: '#26a69a', stopped: '#000000', held: DEFAULT_STATUS_COLORS.held,
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


describe('保留の色', () => {
  it('5 つめの状態の色として、既定はピンク', () => {
    assert.equal(DEFAULT_STATUS_COLORS.held, '#e05aa8');
    assert.ok(COLOR_SWATCHES.includes(DEFAULT_STATUS_COLORS.held));
  });
  it('設定画面では待機と中断の間に並べる', () => assert.deepEqual(COLOR_STATES, ['busy', 'waiting', 'idle', 'held', 'stopped']));
  it('保存されている色に held がなければ既定の色。あれば残す', () => {
    assert.equal(normalizeSettings({ statusColors: { busy: '#000000' } }).statusColors.held, '#e05aa8');
    assert.equal(normalizeSettings({ statusColors: { held: '#A371F7' } }).statusColors.held, '#a371f7');
  });
});

describe('normalizeSettings の holds と heldCards', () => {
  it('なければ空', () => {
    assert.deepEqual(normalizeSettings({}).holds, {});
    assert.deepEqual(normalizeSettings({}).heldCards, {});
  });
  it('正しい印を残す', () => {
    const s = normalizeSettings({
      holds: { 'local_a-1': { note: 'マージ待ち', since: 1000 } },
      heldCards: { 'c:/repo|fix': { note: '', since: 2000 } },
    });
    assert.deepEqual(s.holds, { 'local_a-1': { note: 'マージ待ち', since: 1000 } });
    assert.deepEqual(s.heldCards, { 'c:/repo|fix': { note: '', since: 2000 } });
  });
  it('目印が合わない・note が文字列でない・since が有限の数でないものは捨てる', () => {
    const s = normalizeSettings({
      holds: {
        'not-a-session': { note: '', since: 1 },
        local_b: { note: 1, since: 1 },
        local_c: { note: '', since: Infinity },
        local_d: { note: '', since: '1' },
        local_e: 'held',
        local_f: { note: 'ok', since: 5 },
      },
      heldCards: { '': { note: '', since: 1 }, 'a\nb': { note: '', since: 1 }, 'r|x': { note: 'ok', since: 6 } },
    });
    assert.deepEqual(s.holds, { local_f: { note: 'ok', since: 5 } });
    assert.deepEqual(s.heldCards, { 'r|x': { note: 'ok', since: 6 } });
  });
  it('入れ物が表でなければ空', () => {
    for (const holds of [null, 'x', [{ note: '', since: 1 }]]) assert.deepEqual(normalizeSettings({ holds, heldCards: holds }).holds, {});
  });
  it('メモは制御文字と改行を空白にし、前後の空白を除いて 200 文字まで', () => {
    assert.equal(normalizeSettings({ holds: { local_a: { note: '  あと\nで\t再開\x00 ', since: 1 } } }).holds.local_a!.note, 'あと で 再開');
    assert.equal(normalizeNote('あ'.repeat(HOLD_NOTE_MAX + 50)).length, HOLD_NOTE_MAX);
    assert.equal(normalizeNote(42), '');
  });
});

describe('normalizeSettings のツールチップ', () => {
  it('なければ 0.4 秒', () => assert.equal(normalizeSettings({}).tooltipDelayMs, 400));
  it('0 から右端（出さない）まで通し、範囲の外は丸める', () => {
    assert.equal(normalizeSettings({ tooltipDelayMs: 0 }).tooltipDelayMs, 0);
    assert.equal(normalizeSettings({ tooltipDelayMs: 2000 }).tooltipDelayMs, 2000);
    assert.equal(normalizeSettings({ tooltipDelayMs: 9999 }).tooltipDelayMs, 2000);
    assert.equal(normalizeSettings({ tooltipDelayMs: -5 }).tooltipDelayMs, 0);
    assert.equal(normalizeSettings({ tooltipDelayMs: 'x' }).tooltipDelayMs, 400);
  });
});
