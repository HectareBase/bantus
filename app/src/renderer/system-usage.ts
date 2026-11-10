// タイトルバーの PC 全体の CPU とメモリ。値はメインプロセスが変わったときだけ送ってくる。
// バーの長さは transform（scaleX）で変え、数字とツールチップは変わったときだけ書き換える。

import { ja } from '../shared/strings/ja.js';
import type { SystemUsage } from '../shared/types';
import { memGb, memPercent, percentLevel } from './model.js';

const W = ja.widget;

interface Meter {
  row: HTMLElement;
  fill: HTMLElement;
  num: HTMLElement;
}

function meter(id: string): Meter {
  const row = document.getElementById(id)!;
  return { row, fill: row.querySelector<HTMLElement>('.usage-fill')!, num: row.querySelector<HTMLElement>('.usage-num')! };
}

function setMeter(m: Meter, pct: number, tip: string) {
  const num = `${pct}%`;
  if (m.num.textContent !== num) {
    m.num.textContent = num;
    m.fill.style.transform = `scaleX(${pct / 100})`;
    m.row.dataset.level = percentLevel(pct);
  }
  if (m.row.dataset.tip !== tip) m.row.dataset.tip = tip;
}

export function initSystemUsage() {
  const box = document.getElementById('usage')!;
  const cpu = meter('usage-cpu');
  const mem = meter('usage-mem');
  window.widget.onSystemUsage((u: SystemUsage) => {
    box.hidden = false;
    setMeter(cpu, u.cpu, W.cpuTip(u.cpu));
    const pct = memPercent(u.memUsed, u.memTotal);
    const gb = memGb(u.memUsed, u.memTotal);
    setMeter(mem, pct, W.memTip(gb.used, gb.total, pct));
  });
}
