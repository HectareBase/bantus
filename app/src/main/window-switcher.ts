// ウィンドウの切り替え（docs/design/window-switcher.md）。ウィジェットと同じモニターにある、Claude 以外のウィンドウの一覧を
// 数秒おきに調べ、変わったときだけ画面に送る。作りは system-usage.ts と同じで、タイマーは 1 つだけ。
// ウィジェットが見えていない間と、設定で出さないときは止める。
// 一覧は foreground.ts の常駐の PowerShell に聞き、アイコンは実行ファイルのパスごとに 1 回だけ取って覚える。
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

/** PowerShell が答えたウィンドウ 1 つ */
export interface WindowEntry {
  /** ウィンドウのハンドル（10 進の数字） */
  handle: string;
  minimized: boolean;
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
 * 答えの 1 行を読む。形は「W」のあとに、ウィンドウごとの「;ハンドル:最小化(0/1):パス:タイトル」（パスとタイトルは UTF-8 の base64）。
 * 「W」で始まらない行（空行、時間切れのあとでずれた答え）は undefined。形の合わない項目は捨てる
 */
export function parseWindowList(line: string | undefined): WindowEntry[] | undefined {
  if (!line?.startsWith('W')) return undefined;
  const out: WindowEntry[] = [];
  for (const part of line.slice(1).split(';')) {
    if (!part || out.length >= WINDOW_LIMIT) continue;
    const [handle, min, path64, title64, ...rest] = part.split(':');
    if (!handle || !HANDLE.test(handle) || (min !== '0' && min !== '1') || path64 === undefined || title64 === undefined || rest.length) continue;
    const path = decode(path64);
    const title = decode(title64);
    if (path === undefined || !title) continue;
    out.push({ handle, minimized: min === '1', path, title });
  }
  return out;
}

/** 画面に出るもの（並び、ハンドル、最小化、パス、タイトル）が同じか */
export function sameWindows(a: readonly WindowEntry[], b: readonly WindowEntry[]): boolean {
  return a.length === b.length && a.every((x, i) => {
    const y = b[i]!;
    return x.handle === y.handle && x.minimized === y.minimized && x.path === y.path && x.title === y.title;
  });
}

export interface WindowSwitcherDeps {
  /** 一覧の答えの 1 行（foreground.ts の askWindowList）。調べられなければ undefined */
  list: () => Promise<string | undefined>;
  /** 実行ファイルのアイコン（data URL）。取れなければ undefined */
  icon: (path: string) => Promise<string | undefined>;
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
  /** 実行ファイルのパス → アイコンの目印。取れなかったパスも入れ、取り直さない */
  const iconKeys = new Map<string, string>();
  /** アイコンの目印 → data URL */
  const icons = new Map<string, string>();
  /** 画面に送り済みのアイコンの目印。同じ絵を何度も送らない */
  const sent = new Set<string>();

  async function loadIcons(list: readonly WindowEntry[]) {
    const fresh = [...new Set(list.map((w) => w.path))].filter((path) => path && !iconKeys.has(path));
    await Promise.all(fresh.map(async (path) => {
      const key = `i${iconKeys.size}`;
      iconKeys.set(path, key);
      const url = await deps.icon(path).catch(() => undefined);
      if (url) icons.set(key, url);
    }));
  }

  function push(list: readonly WindowEntry[]) {
    const fresh: Record<string, string> = {};
    const windows = list.map((w): SwitcherWindow => {
      const key = iconKeys.get(w.path);
      const url = key === undefined ? undefined : icons.get(key);
      if (key === undefined || url === undefined) return { id: w.handle, title: w.title, minimized: w.minimized };
      if (!sent.has(key)) {
        sent.add(key);
        fresh[key] = url;
      }
      return { id: w.handle, title: w.title, minimized: w.minimized, icon: key };
    });
    deps.send({ windows, icons: fresh });
  }

  async function check() {
    if (busy) return;
    busy = true;
    try {
      // 答えがない（PowerShell が使えない、時間切れ）ときは、1 つもないものとして帯を消す
      const list = parseWindowList(await deps.list().catch(() => undefined)) ?? [];
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
