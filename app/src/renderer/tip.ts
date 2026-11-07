// ツールチップのウィンドウの中身。文字を受け取ったら大きさを測ってメインプロセスに返し、置き終えたら浮かび上がらせる。

import { ja } from '../shared/strings/ja.js';

document.title = ja.window.tip(ja.app.name);

const tip = document.getElementById('tip')!;

window.tipApi.onText((text) => {
  tip.textContent = text;
  const { width, height } = tip.getBoundingClientRect();
  window.tipApi.reportSize(width, height);
});

window.tipApi.onVisible((visible) => tip.classList.toggle('open', visible));
