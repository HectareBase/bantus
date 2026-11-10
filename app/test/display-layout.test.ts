// モニターの構成ごとに置くモニターを覚える処理（src/shared/display-layout.ts）

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LAYOUT_MEMORY_MAX, PRIMARY, currentChoice, displayChoices, layoutKey, migrateLegacyDisplay, monitorSignatures, normalizeDisplayByLayout, pickMonitor, rememberChoice, settleTimers,
  type DisplayMemory, type MonitorInfo,
} from '../src/shared/display-layout';
import { normalizeSettings } from '../src/shared/settings';

/** 内蔵の画面（2880×1800 を 200% で使う） */
const laptop = (id = 1, x = 0): MonitorInfo => ({ id, label: '', internal: true, size: { width: 1440, height: 900 }, scaleFactor: 2, bounds: { x, y: 0 } });
/** 外部モニター（2560×1440 を 100% で使う） */
const external = (id = 2, x = 1440, label = 'DELL U2720Q'): MonitorInfo => ({ id, label, internal: false, size: { width: 2560, height: 1440 }, scaleFactor: 1, bounds: { x, y: 0 } });

const empty: DisplayMemory = { display: PRIMARY, displayByLayout: {} };

describe('monitorSignatures', () => {
  it('内蔵は internal、外部は名前。どちらも物理の解像度をつける', () =>
    assert.deepEqual(monitorSignatures([laptop(), external()]), ['internal@2880x1800', 'DELL U2720Q@2560x1440']));
  it('名前がなければ display', () => assert.deepEqual(monitorSignatures([external(2, 0, '  ')]), ['display@2560x1440']));
  it('縦置きでも同じしるし', () => {
    const portrait = { ...external(), size: { width: 1440, height: 2560 } };
    assert.deepEqual(monitorSignatures([portrait]), monitorSignatures([external()]));
  });
  it('同じ型が 2 台あれば、左から 2 台目に #2 をつける（入力の並びにはよらない）', () => {
    const right = external(5, 4000);
    const left = external(9, 1440);
    assert.deepEqual(monitorSignatures([right, laptop(), left]), ['DELL U2720Q@2560x1440#2', 'internal@2880x1800', 'DELL U2720Q@2560x1440']);
  });
});

describe('layoutKey', () => {
  it('id や並びが変わっても同じ構成なら同じキー', () =>
    assert.equal(layoutKey([laptop(1), external(2)]), layoutKey([external(7), laptop(3)])));
  it('外部モニターを外すと別のキー', () => assert.notEqual(layoutKey([laptop()]), layoutKey([laptop(), external()])));
  it('別のモニターにつなぎ替えると別のキー', () =>
    assert.notEqual(layoutKey([laptop(), external()]), layoutKey([laptop(), external(2, 1440, 'LG 27UL850')])));
});

describe('pickMonitor', () => {
  const both = [laptop(1), external(2)];
  it('primary はメインのモニター', () => assert.equal(pickMonitor(PRIMARY, both, 2), 2));
  it('しるしで探す（id が変わっていても見つかる）', () => assert.equal(pickMonitor('DELL U2720Q@2560x1440', [laptop(10), external(20)], 10), 20));
  it('古い版の id でも探す', () => assert.equal(pickMonitor('2', both, 1), 2));
  it('見つからなければメインのモニター', () => {
    assert.equal(pickMonitor('DELL U2720Q@2560x1440', [laptop(1)], 1), 1);
    assert.equal(pickMonitor('99', both, 1), 1);
  });
});

describe('構成ごとに覚える', () => {
  const docked = [laptop(1), external(2)];
  const alone = [laptop(1)];
  it('覚えがなければ単一の設定（ふつうは primary）', () => assert.equal(currentChoice(empty, docked), PRIMARY));
  it('選んだモニターは今の構成に結びつく', () => {
    const mem = rememberChoice(empty, docked, 'DELL U2720Q@2560x1440');
    assert.equal(currentChoice(mem, docked), 'DELL U2720Q@2560x1440');
    assert.equal(currentChoice(mem, alone), PRIMARY);
  });
  it('外す → 内蔵だけの値、つなぎ直す → 外部モニターの値に戻る', () => {
    let mem = rememberChoice(empty, docked, 'DELL U2720Q@2560x1440');
    mem = rememberChoice(mem, alone, PRIMARY);
    // 外した
    assert.equal(pickMonitor(currentChoice(mem, alone), alone, 1), 1);
    // つなぎ直した（id が変わっても戻る）
    const again = [laptop(5), external(6)];
    assert.equal(pickMonitor(currentChoice(mem, again), again, 5), 6);
  });
  it('選び直した構成は後ろへ回し、上限を超えた古い構成は捨てる', () => {
    let mem = empty;
    for (let i = 0; i < LAYOUT_MEMORY_MAX + 3; i++) mem = rememberChoice(mem, [external(1, 0, `M${i}`)], PRIMARY);
    const keys = Object.keys(mem.displayByLayout);
    assert.equal(keys.length, LAYOUT_MEMORY_MAX);
    assert.equal(keys[0], layoutKey([external(1, 0, 'M3')]));
    mem = rememberChoice(mem, [external(1, 0, 'M3')], 'x');
    assert.equal(Object.keys(mem.displayByLayout).at(-1), layoutKey([external(1, 0, 'M3')]));
  });
  it('選ぶと単一の設定は primary に戻す', () => assert.equal(rememberChoice({ display: '2', displayByLayout: {} }, docked, PRIMARY).display, PRIMARY));
});

describe('migrateLegacyDisplay', () => {
  const docked = [laptop(1), external(2)];
  it('古い id のモニターが今つながっていれば、今の構成の覚えに移す', () =>
    assert.deepEqual(migrateLegacyDisplay({ display: '2', displayByLayout: {} }, docked), {
      display: PRIMARY,
      displayByLayout: { [layoutKey(docked)]: 'DELL U2720Q@2560x1440' },
    }));
  it('つながっていなければ移さない（単一の設定は残す）', () => assert.equal(migrateLegacyDisplay({ display: '2', displayByLayout: {} }, [laptop(1)]), undefined));
  it('primary なら移すものはない', () => assert.equal(migrateLegacyDisplay(empty, docked), undefined));
  it('今の構成にもう覚えがあれば上書きしない', () =>
    assert.equal(migrateLegacyDisplay({ display: '2', displayByLayout: { [layoutKey(docked)]: PRIMARY } }, docked), undefined));
});

describe('displayChoices', () => {
  const docked = [laptop(1), external(2)];
  it('メインは primary、ほかはしるし', () =>
    assert.deepEqual(displayChoices(empty, docked, 1).values, [{ id: 1, value: PRIMARY }, { id: 2, value: 'DELL U2720Q@2560x1440' }]));
  it('今の構成で選んだものを選ぶ', () =>
    assert.equal(displayChoices(rememberChoice(empty, docked, 'DELL U2720Q@2560x1440'), docked, 1).selected, 'DELL U2720Q@2560x1440'));
  it('選んだモニターがメインになっていれば primary を選ぶ', () =>
    assert.equal(displayChoices(rememberChoice(empty, docked, 'DELL U2720Q@2560x1440'), docked, 2).selected, PRIMARY));
  it('古い版の id でも、そのモニターの選択肢を選ぶ', () => assert.equal(displayChoices({ display: '2', displayByLayout: {} }, docked, 1).selected, 'DELL U2720Q@2560x1440'));
});

describe('normalizeDisplayByLayout', () => {
  it('文字列の値だけ残す', () => assert.deepEqual(normalizeDisplayByLayout({ a: 'primary', b: 3, c: '' }), { a: 'primary' }));
  it('オブジェクトでなければ空', () => {
    assert.deepEqual(normalizeDisplayByLayout(['x']), {});
    assert.deepEqual(normalizeDisplayByLayout('x'), {});
  });
  it('設定の読み込みでも確かめる。既定は空', () => {
    assert.deepEqual(normalizeSettings({}).displayByLayout, {});
    assert.deepEqual(normalizeSettings({ displayByLayout: { k: 'primary', n: null } }).displayByLayout, { k: 'primary' });
  });
  it('古い版の display はそのまま読む', () => assert.equal(normalizeSettings({ display: '12345' }).display, '12345'));
});

describe('settleTimers', () => {
  it('呼び直すと前の予定を取り消し、間ごとに 1 回ずつ呼ぶ', () => {
    const scheduled: { fn: () => void; ms: number; cleared: boolean }[] = [];
    const timers = {
      set: ((fn: () => void, ms: number) => scheduled.push({ fn, ms, cleared: false }) - 1) as unknown as typeof setTimeout,
      clear: ((i: number) => { scheduled[i]!.cleared = true; }) as unknown as typeof clearTimeout,
    };
    let runs = 0;
    const settle = settleTimers(() => runs++, timers);
    settle([1000, 3000]);
    settle([500]);
    assert.deepEqual(scheduled.map((t) => [t.ms, t.cleared]), [[1000, true], [3000, true], [500, false]]);
    for (const t of scheduled) if (!t.cleared) t.fn();
    assert.equal(runs, 1);
  });
});
