// ウィンドウの切り替え（docs/design/window-switcher.md）。ウィジェットと同じモニターにある、Claude 以外のウィンドウの一覧を
// 数秒おきに調べ、変わったときだけ画面に送る。作りは system-usage.ts と同じで、タイマーは 1 つだけ。
// ウィジェットが見えていない間と、設定で出さないときは止める。
// 一覧は foreground.ts の常駐の補助プログラムに聞き、アイコンはウィンドウごとに 1 回だけ取って覚える。
// Electron に触れるところ（一覧の問い合わせ、アイコン、画面への送信）は呼ぶ側から受け取る。

import type { SwitcherUpdate, SwitcherWindow } from '../shared/types';

/** 取得の間隔（ms）。負荷をかけないよう、数秒おきにする */
export const WINDOW_SWITCHER_MS = 3000;
/** 動き出してから最初に調べるまで（ms） */
const FIRST_MS = 100;
/** マウスを乗せたときに調べ直すのは、前に調べてからこの時間（ms）が過ぎているときだけ */
const ENTER_GAP_MS = 500;
/** 並べるウィンドウの上限。これより多い分は捨てる（答えの行と画面への送信を小さく保つ） */
export const WINDOW_LIMIT = 60;

/** 補助プログラムが答えたウィンドウ 1 つ */
export interface WindowEntry {
  /** ウィンドウのハンドル（10 進の数字） */
  handle: string;
  minimized: boolean;
  /** 今前面にある（前面のウィンドウか、その持ち主） */
  active: boolean;
  /** プロセスの起動時刻（FILETIME の 10 進の数字）。わからなければ '0' */
  created: string;
  /** 実行ファイルのパス。引けなかったときは空 */
  path: string;
  title: string;
}

const HANDLE = /^\d{1,20}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function decode(text: string): string | undefined {
  return BASE64.test(text) ? Buffer.from(text, 'base64').toString('utf8') : undefined;
}

/**
 * 答えの 1 行を読む。形は「W」のあとに、ウィンドウごとの「;ハンドル:最小化(0/1):前面(0/1):起動時刻:パス:タイトル」
 * （パスとタイトルは UTF-8 の base64）。並びは手前にある順。
 * 「W」で始まらない行（空行、時間切れのあとでずれた答え）は undefined。形の合わない項目は捨てる
 */
export function parseWindowList(line: string | undefined): WindowEntry[] | undefined {
  if (!line?.startsWith('W')) return undefined;
  const out: WindowEntry[] = [];
  for (const part of line.slice(1).split(';')) {
    if (!part || out.length >= WINDOW_LIMIT) continue;
    const [handle, min, active, created, path64, title64, ...rest] = part.split(':');
    if (!handle || !HANDLE.test(handle) || (min !== '0' && min !== '1') || (active !== '0' && active !== '1')) continue;
    if (!created || !/^\d{1,20}$/.test(created) || path64 === undefined || title64 === undefined || rest.length) continue;
    const path = decode(path64);
    const title = decode(title64);
    if (path === undefined || !title) continue;
    out.push({ handle, minimized: min === '1', active: active === '1', created, path, title });
  }
  return out;
}

/** 10 進の数字の文字列を比べる（FILETIME とハンドルは Number に収まらないことがある） */
function compareDigits(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * 帯に並べる順。押して前後が入れ替わっても位置が変わらないよう、手前の順は使わない。
 * タスクバーと同じく、同じアプリ（実行ファイル）のウィンドウを隣り合わせにまとめ、アプリは起動した順（そのアプリの一番古いプロセス）、
 * アプリの中はプロセスの起動した順、同じプロセスの中はハンドルの順にする。起動時刻がわからないもの（0）は先に来る
 */
export function orderWindows(list: readonly WindowEntry[]): WindowEntry[] {
  const groupOf = (w: WindowEntry) => (w.path ? w.path.toLowerCase() : `#${w.handle}`);
  const first = new Map<string, string>();
  for (const w of list) {
    const g = groupOf(w);
    const seen = first.get(g);
    if (seen === undefined || compareDigits(w.created, seen) < 0) first.set(g, w.created);
  }
  return [...list].sort((a, b) => {
    const ga = groupOf(a);
    const gb = groupOf(b);
    return compareDigits(first.get(ga)!, first.get(gb)!) || (ga < gb ? -1 : ga > gb ? 1 : 0)
      || compareDigits(a.created, b.created) || compareDigits(a.handle, b.handle);
  });
}

/** 画面に出るもの（並び、ハンドル、最小化、前面、タイトル）が同じか */
export function sameWindows(a: readonly WindowEntry[], b: readonly WindowEntry[]): boolean {
  return a.length === b.length && a.every((x, i) => {
    const y = b[i]!;
    return x.handle === y.handle && x.minimized === y.minimized && x.active === y.active && x.path === y.path && x.title === y.title;
  });
}

export interface WindowSwitcherDeps {
  /** 一覧の答えの 1 行（foreground.ts の askWindowList）。調べられなければ undefined */
  list: () => Promise<string | undefined>;
  /** ウィンドウのアイコン（data URL）。取れなければ undefined */
  icon: (window: WindowEntry) => Promise<string | undefined>;
  send: (update: SwitcherUpdate) => void;
}

export interface WindowSwitcher {
  /** 調べるかどうか（設定で出す、かつウィジェットが見えている）。false にするとタイマーを止める */
  setActive(active: boolean): void;
  /** すぐ調べ直す（マウスをウィジェットに乗せたとき）。force でなければ、調べたばかりのときは何もしない */
  refresh(force?: boolean): void;
  /** 画面を読み込み直したときに、最後の一覧をアイコンごと送り直す */
  resend(): void;
  /** 最後に送った一覧にあるハンドルか（画面から届いたハンドルを確かめる） */
  has(handle: string): boolean;
}

export function createWindowSwitcher(deps: WindowSwitcherDeps): WindowSwitcher {
  let timer: NodeJS.Timeout | undefined;
  let active = false;
  let busy = false;
  let checkedAt = 0;
  let last: WindowEntry[] | undefined;
  /** ウィンドウのハンドル → アイコンの目印（取れなかったときは空）。取れなかったウィンドウも入れ、取り直さない */
  const iconKeys = new Map<string, string>();
  /** アイコンの data URL → 目印。同じ絵のウィンドウ（同じアプリ）は同じ目印にまとめる */
  const urlKeys = new Map<string, string>();
  /** アイコンの目印 → data URL */
  const icons = new Map<string, string>();
  /** 画面に送り済みのアイコンの目印。同じ絵を何度も送らない */
  const sent = new Set<string>();

  async function loadIcons(list: readonly WindowEntry[]) {
    // 消えたウィンドウの分は忘れる（ハンドルは使い回されることがある）
    const handles = new Set(list.map((w) => w.handle));
    for (const h of iconKeys.keys()) if (!handles.has(h)) iconKeys.delete(h);
    for (const w of list) {
      if (iconKeys.has(w.handle)) continue;
      const url = await deps.icon(w).catch(() => undefined);
      let key = '';
      if (url) {
        key = urlKeys.get(url) ?? `i${urlKeys.size}`;
        urlKeys.set(url, key);
        icons.set(key, url);
      }
      iconKeys.set(w.handle, key);
    }
  }

  function push(list: readonly WindowEntry[]) {
    const fresh: Record<string, string> = {};
    const windows = list.map((w): SwitcherWindow => {
      const base = { id: w.handle, title: w.title, minimized: w.minimized, active: w.active };
      const key = iconKeys.get(w.handle);
      const url = key ? icons.get(key) : undefined;
      if (!key || url === undefined) return base;
      if (!sent.has(key)) {
        sent.add(key);
        fresh[key] = url;
      }
      return { ...base, icon: key };
    });
    deps.send({ windows, icons: fresh });
  }

  async function check() {
    if (busy) return;
    busy = true;
    try {
      // 答えがない（補助プログラムが使えない、時間切れ）ときは、1 つもないものとして帯を消す
      const list = orderWindows(parseWindowList(await deps.list().catch(() => undefined)) ?? []);
      checkedAt = Date.now();
      if (!active) return;
      await loadIcons(list);
      if (!active || (last && sameWindows(last, list))) return;
      last = list;
      push(list);
    } finally {
      busy = false;
    }
  }

  const tick = () => {
    timer = setTimeout(tick, WINDOW_SWITCHER_MS);
    void check();
  };

  return {
    setActive(next) {
      if (next === active) return;
      active = next;
      clearTimeout(timer);
      timer = next ? setTimeout(tick, FIRST_MS) : undefined;
    },
    refresh(force = false) {
      if (!active || (!force && Date.now() - checkedAt < ENTER_GAP_MS)) return;
      void check();
    },
    resend() {
      sent.clear();
      if (last) push(last);
    },
    has: (handle) => !!last?.some((w) => w.handle === handle),
  };
}
