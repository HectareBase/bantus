// ウィンドウの切り替え（src/main/window-switcher.ts と、帯に入る数の計算 src/shared/switcher-fit.ts）

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WINDOW_LIMIT, createWindowSwitcher, orderWindows, parseWindowList, sameWindows, type WindowEntry } from '../src/main/window-switcher';
import { switcherFit } from '../src/shared/switcher-fit';
import { normalizeSettings } from '../src/shared/settings';
import type { SwitcherUpdate } from '../src/shared/types';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
interface Part { h: string; min?: boolean; active?: boolean; created?: string; path?: string; title?: string }
const part = ({ h, min = false, active = false, created = '100', path = 'C:\\a.exe', title = 't' }: Part) =>
  `;${h}:${min ? 1 : 0}:${active ? 1 : 0}:${created}:${b64(path)}:${b64(title)}`;
const entry = (handle: string, path: string, created: string): WindowEntry => ({ handle, minimized: false, active: false, created, path, title: 't' });

describe('答えの行の読み取り', () => {
  it('ハンドル、最小化、前面、起動時刻、パス、タイトル（base64。日本語や区切りの文字を含む）を読む', () => {
    const line = `W${part({ h: '123', active: true, created: '134379021006239718', path: 'C:\\a\\note.exe', title: 'メモ: a;b' })}${part({ h: '456', min: true, path: '', title: 'x' })}`;
    assert.deepEqual(parseWindowList(line), [
      { handle: '123', minimized: false, active: true, created: '134379021006239718', path: 'C:\\a\\note.exe', title: 'メモ: a;b' },
      { handle: '456', minimized: true, active: false, created: '100', path: '', title: 'x' },
    ]);
  });
  it('1 つもなければ空', () => assert.deepEqual(parseWindowList('W'), []));
  it('W で始まらない行（空行、ずれた答え）は undefined', () => {
    assert.equal(parseWindowList(''), undefined);
    assert.equal(parseWindowList(undefined), undefined);
    assert.equal(parseWindowList('claude'), undefined);
  });
  it('形の合わない項目は捨てる', () => {
    const p = b64('p');
    const t = b64('t');
    const bad = [`abc:0:0:1:${p}:${t}`, `1:2:0:1:${p}:${t}`, `1:0:2:1:${p}:${t}`, `1:0:0:x:${p}:${t}`, `1:0:0:1:${p}`, `1:0:0:1:${p}:`, '1:0:0:1:!!:!!', `1:0:0:1:${p}:${t}:x`];
    const line = `W;${bad.join(';')}${part({ h: '9' })}`;
    assert.deepEqual(parseWindowList(line)?.map((w) => w.handle), ['9']);
  });
  it(`${WINDOW_LIMIT} 件より多い分は捨てる`, () => {
    const line = 'W' + Array.from({ length: WINDOW_LIMIT + 5 }, (_, i) => part({ h: String(i + 1) })).join('');
    assert.equal(parseWindowList(line)?.length, WINDOW_LIMIT);
  });
});

describe('並び順', () => {
  it('同じアプリをまとめ、アプリは起動した順（一番古いプロセス）、中はプロセスの起動順、同じプロセスはハンドルの順', () => {
    const list = [
      entry('50', 'C:\\chrome.exe', '300'),
      entry('7', 'C:\\note.exe', '200'),
      entry('40', 'C:\\chrome.exe', '100'),
      entry('30', 'C:\\Chrome.exe', '100'),
      entry('8', 'C:\\note.exe', '250'),
    ];
    assert.deepEqual(orderWindows(list).map((w) => w.handle), ['30', '40', '50', '7', '8']);
  });
  it('手前の順が変わっても（前に出しても）並びは変わらない', () => {
    const a = [entry('1', 'C:\\a.exe', '1'), entry('2', 'C:\\b.exe', '2'), entry('3', 'C:\\c.exe', '3')];
    assert.deepEqual(orderWindows([a[2]!, a[0]!, a[1]!]).map((w) => w.handle), orderWindows(a).map((w) => w.handle));
  });
  it('桁の多い数（FILETIME、64 ビットのハンドル）も数として比べる', () => {
    const list = [entry('10000000000000000001', 'C:\\a.exe', '134389582539329064'), entry('9', 'C:\\a.exe', '134389582539329064'), entry('5', 'C:\\b.exe', '99999999999999999')];
    assert.deepEqual(orderWindows(list).map((w) => w.handle), ['5', '9', '10000000000000000001']);
  });
  it('パスがわからないウィンドウは、それぞれ 1 つのアプリとして扱う', () => {
    const list = [entry('2', '', '0'), entry('1', 'C:\\a.exe', '5'), entry('3', '', '0')];
    assert.deepEqual(orderWindows(list).map((w) => w.handle), ['2', '3', '1']);
  });
});

describe('同じかどうか', () => {
  const a: WindowEntry = entry('1', 'p', '1');
  it('同じ並びと中身なら同じ', () => assert.equal(sameWindows([a], [{ ...a }]), true));
  it('最小化、前面、タイトル、並び、数が変われば違う', () => {
    const c = { ...a, handle: '2' };
    assert.equal(sameWindows([a], [{ ...a, minimized: true }]), false);
    assert.equal(sameWindows([a], [{ ...a, active: true }]), false);
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
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };
  it('前回と同じなら送らない。アイコンはウィンドウごとに 1 回だけ取り、同じ絵は 1 つの目印にまとめて 1 回だけ送る', async () => {
    let line = `W${part({ h: '2', title: 'B' })}${part({ h: '1', title: 'A' })}`;
    const iconCalls: string[] = [];
    const sent: SwitcherUpdate[] = [];
    const sw = createWindowSwitcher({
      list: async () => line,
      icon: async (w) => {
        iconCalls.push(w.handle);
        return 'data:image/png;base64,AA';
      },
      send: (u) => sent.push(u),
    });
    sw.setActive(true);
    sw.refresh(true);
    await settle();
    sw.refresh(true);
    await settle();
    assert.equal(sent.length, 1);
    assert.deepEqual(iconCalls.sort(), ['1', '2']);
    // 並びは手前の順でなく、同じプロセスの中はハンドルの順
    assert.deepEqual(sent[0]!.windows.map((w) => [w.id, w.icon]), [['1', 'i0'], ['2', 'i0']]);
    assert.deepEqual(Object.keys(sent[0]!.icons), ['i0']);
    assert.equal(sw.has('2'), true);
    assert.equal(sw.has('3'), false);
    // 前面が変わったら送る。アイコンはもう送ったので入れない
    line = `W${part({ h: '1', title: 'A', active: true })}${part({ h: '2', title: 'B' })}`;
    sw.refresh(true);
    await settle();
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1]!.icons, {});
    assert.deepEqual(sent[1]!.windows.map((w) => [w.id, w.active]), [['1', true], ['2', false]]);
    sw.setActive(false);
  });
  it('答えがない（PowerShell が答えない）ときは、空の一覧を送って帯を消す', async () => {
    let answer: string | undefined = `W${part({ h: '1', path: '' })}`;
    const sent: SwitcherUpdate[] = [];
    const sw = createWindowSwitcher({ list: async () => answer, icon: async () => undefined, send: (u) => sent.push(u) });
    sw.setActive(true);
    sw.refresh(true);
    await settle();
    answer = undefined;
    sw.refresh(true);
    await settle();
    assert.deepEqual(sent.map((u) => u.windows.length), [1, 0]);
    // アイコンが取れないウィンドウは、アイコンの目印なし
    assert.equal(sent[0]!.windows[0]!.icon, undefined);
    sw.setActive(false);
  });
  it('止めている間は調べない', async () => {
    let calls = 0;
    const sw = createWindowSwitcher({ list: async () => (calls++, 'W'), icon: async () => undefined, send: () => {} });
    sw.refresh(true);
    await settle();
    assert.equal(calls, 0);
  });
});

describe('設定', () => {
  it('既定は出す', () => assert.equal(normalizeSettings({}).showWindowSwitcher, true));
  it('出さないを選べる', () => assert.equal(normalizeSettings({ showWindowSwitcher: false }).showWindowSwitcher, false));
});
