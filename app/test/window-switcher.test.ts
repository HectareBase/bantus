// ウィンドウの切り替え（src/main/window-switcher.ts と、帯に入る数の計算 src/renderer/switcher.ts）

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WINDOW_LIMIT, createWindowSwitcher, parseWindowList, sameWindows, type WindowEntry } from '../src/main/window-switcher';
import { switcherFit } from '../src/shared/switcher-fit';
import { normalizeSettings } from '../src/shared/settings';
import type { SwitcherUpdate } from '../src/shared/types';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const part = (h: string, min: boolean, path: string, title: string) => `;${h}:${min ? 1 : 0}:${b64(path)}:${b64(title)}`;

describe('答えの行の読み取り', () => {
  it('手前から順に読む。パスとタイトルは base64（日本語、区切りの文字を含む）', () => {
    const line = `W${part('123', false, 'C:\\a\\note.exe', 'メモ: a;b')}${part('456', true, '', 'x')}`;
    assert.deepEqual(parseWindowList(line), [
      { handle: '123', minimized: false, path: 'C:\\a\\note.exe', title: 'メモ: a;b' },
      { handle: '456', minimized: true, path: '', title: 'x' },
    ]);
  });
  it('1 つもなければ空', () => assert.deepEqual(parseWindowList('W'), []));
  it('W で始まらない行（空行、ずれた答え）は undefined', () => {
    assert.equal(parseWindowList(''), undefined);
    assert.equal(parseWindowList(undefined), undefined);
    assert.equal(parseWindowList('claude'), undefined);
  });
  it('形の合わない項目は捨てる', () => {
    const bad = ['abc:0:::', `1:2:${b64('p')}:${b64('t')}`, `1:0:${b64('p')}`, `1:0:${b64('p')}:`, '1:0:!!:!!', `1:0:${b64('p')}:${b64('t')}:x`];
    const line = `W;${bad.join(';')}${part('9', false, 'p', 't')}`;
    assert.deepEqual(parseWindowList(line)?.map((w) => w.handle), ['9']);
  });
  it(`${WINDOW_LIMIT} 件より多い分は捨てる`, () => {
    const line = 'W' + Array.from({ length: WINDOW_LIMIT + 5 }, (_, i) => part(String(i + 1), false, 'p', 't')).join('');
    assert.equal(parseWindowList(line)?.length, WINDOW_LIMIT);
  });
});

describe('同じかどうか', () => {
  const a: WindowEntry = { handle: '1', minimized: false, path: 'p', title: 't' };
  it('同じ並びと中身なら同じ', () => assert.equal(sameWindows([a], [{ ...a }]), true));
  it('最小化、タイトル、並び、数が変われば違う', () => {
    const c = { ...a, handle: '2' };
    assert.equal(sameWindows([a], [{ ...a, minimized: true }]), false);
    assert.equal(sameWindows([a], [{ ...a, title: 'u' }]), false);
    assert.equal(sameWindows([a, c], [c, a]), false);
    assert.equal(sameWindows([a], [a, c]), false);
  });
});

describe('帯に入る数', () => {
  // ボタンは 24px、間は 2px、「+N」は 32px
  it('すべて入ればすべて', () => {
    assert.equal(switcherFit(3, 3 * 24 + 2 * 2), 3);
    assert.equal(switcherFit(0, 200), 0);
  });
  it('入りきらなければ「+N」の分を空ける', () => {
    // 200px：(200 - 32) / 26 = 6.4 → 6 個と「+4」
    assert.equal(switcherFit(10, 200), 6);
  });
  it('1px 足りないだけでも「+N」の分を空ける（101px に 4 個：(101 - 32) / 26 → 2 個と「+2」）', () => {
    assert.equal(switcherFit(4, 4 * 24 + 3 * 2 - 1), 2);
  });
  it('「+N」は少なくとも 1 件をまとめる（広くても total - 1 まで）', () => assert.equal(switcherFit(2, 49, 24, 2, 0), 1));
  it('狭すぎるときは 0（「+N」だけ）', () => assert.equal(switcherFit(5, 20), 0));
});

describe('取得と送信', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  it('前回と同じなら送らない。アイコンはパスごとに 1 回だけ取り、1 回だけ送る', async () => {
    let line = `W${part('1', false, 'C:\\a.exe', 'A')}${part('2', false, 'C:\\a.exe', 'B')}`;
    const iconCalls: string[] = [];
    const sent: SwitcherUpdate[] = [];
    const sw = createWindowSwitcher({
      list: async () => line,
      icon: async (p) => {
        iconCalls.push(p);
        return 'data:image/png;base64,AA';
      },
      send: (u) => sent.push(u),
    });
    sw.setActive(true);
    sw.refresh(true);
    await tick();
    await tick();
    sw.refresh(true);
    await tick();
    await tick();
    assert.equal(sent.length, 1);
    assert.deepEqual(iconCalls, ['C:\\a.exe']);
    assert.deepEqual(sent[0]!.windows.map((w) => [w.id, w.icon]), [['1', 'i0'], ['2', 'i0']]);
    assert.deepEqual(Object.keys(sent[0]!.icons), ['i0']);
    assert.equal(sw.has('2'), true);
    assert.equal(sw.has('3'), false);
    // 最小化が変わったら送る。アイコンはもう送ったので入れない
    line = `W${part('1', true, 'C:\\a.exe', 'A')}`;
    sw.refresh(true);
    await tick();
    await tick();
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1]!.icons, {});
    assert.equal(sent[1]!.windows[0]!.minimized, true);
    sw.setActive(false);
  });
  it('答えがない（PowerShell が答えない）ときは、空の一覧を送って帯を消す', async () => {
    let answer: string | undefined = `W${part('1', false, '', 'A')}`;
    const sent: SwitcherUpdate[] = [];
    const sw = createWindowSwitcher({ list: async () => answer, icon: async () => undefined, send: (u) => sent.push(u) });
    sw.setActive(true);
    sw.refresh(true);
    await tick();
    answer = undefined;
    sw.refresh(true);
    await tick();
    assert.deepEqual(sent.map((u) => u.windows.length), [1, 0]);
    // アイコンが取れないウィンドウは、アイコンの目印なし
    assert.equal(sent[0]!.windows[0]!.icon, undefined);
    sw.setActive(false);
  });
  it('止めている間は調べない', async () => {
    let calls = 0;
    const sw = createWindowSwitcher({ list: async () => (calls++, 'W'), icon: async () => undefined, send: () => {} });
    sw.refresh(true);
    await tick();
    assert.equal(calls, 0);
  });
});

describe('設定', () => {
  it('既定は出す', () => assert.equal(normalizeSettings({}).showWindowSwitcher, true));
  it('出さないを選べる', () => assert.equal(normalizeSettings({ showWindowSwitcher: false }).showWindowSwitcher, false));
});
