// PC 全体の CPU とメモリの使用率（タイトルバーに出す）。タイマーは 1 つだけで、ウィジェットが見えていない間と、
// 設定で出さないときは止める。CPU は os.cpus() の times の前回との差から、メモリは totalmem と freemem から出す。

import { cpus, freemem, totalmem, type CpuInfo } from 'node:os';
import type { SystemUsage } from '../shared/types';

/** 取得の間隔（ms）。負荷をかけないよう、数秒おきにする */
export const SYSTEM_USAGE_MS = 3000;
/** 動き出してから最初に送るまで（ms）。CPU は 2 回の差なので、少しだけ間を空ける */
const FIRST_MS = 300;

interface CpuSample {
  idle: number;
  total: number;
}

/** すべてのコアの times を足し合わせる */
export function sampleCpu(list: Pick<CpuInfo, 'times'>[] = cpus()): CpuSample {
  let idle = 0;
  let total = 0;
  for (const { times } of list) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

/** 2 回の取得の差から使用率（%、整数）。差がなければ 0 */
export function cpuPercent(prev: CpuSample, next: CpuSample): number {
  const total = next.total - prev.total;
  if (total <= 0) return 0;
  const busy = total - (next.idle - prev.idle);
  return Math.min(100, Math.max(0, Math.round((busy / total) * 100)));
}

export interface SystemUsageProbe {
  /** 取得するかどうか（設定で出す、かつウィジェットが見えている）。false にするとタイマーを止める */
  setActive(active: boolean): void;
  /** 最後に送った値（画面を読み込み直したときに送り直す） */
  last(): SystemUsage | undefined;
}

export function createSystemUsage(send: (usage: SystemUsage) => void): SystemUsageProbe {
  let timer: NodeJS.Timeout | undefined;
  let prev: CpuSample | undefined;
  let last: SystemUsage | undefined;

  const tick = () => {
    const next = sampleCpu();
    const total = totalmem();
    const usage: SystemUsage = {
      cpu: prev ? cpuPercent(prev, next) : 0,
      memUsed: total - freemem(),
      memTotal: total,
    };
    prev = next;
    timer = setTimeout(tick, SYSTEM_USAGE_MS);
    // 画面は割合を整数で出すので、変わらなければ送らない
    if (last && sameOnScreen(last, usage)) return;
    last = usage;
    send(usage);
  };

  return {
    setActive(active) {
      if (active === (timer !== undefined)) return;
      if (!active) {
        clearTimeout(timer);
        timer = undefined;
        return;
      }
      prev = sampleCpu();
      timer = setTimeout(tick, FIRST_MS);
    },
    last: () => last,
  };
}

/** 画面に出る値（CPU の %、メモリの %、ツールチップの 0.1 GB の桁）が同じか */
function sameOnScreen(a: SystemUsage, b: SystemUsage): boolean {
  const pct = (u: SystemUsage) => Math.round((u.memUsed / u.memTotal) * 100);
  const tenth = (u: SystemUsage) => Math.round(u.memUsed / GB_TENTH);
  return a.cpu === b.cpu && pct(a) === pct(b) && tenth(a) === tenth(b) && a.memTotal === b.memTotal;
}

const GB_TENTH = 2 ** 30 / 10;
