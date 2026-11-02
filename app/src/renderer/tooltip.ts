// ツールチップ。data-tip を持つ要素にホバーするか、キーボードでフォーカスしたときに出す。
// title 属性と違い、見た目とアニメーションを CSS で決められる。要素は 1 つだけで、出すたびに中身と基準の要素を差し替える。
// 位置は CSS anchor positioning（styles.css の .tooltip）。popover="hint" で最上位の層に出すので、カードの枠で切れない。
// ただしウィンドウの外には出せない。たたんだ表示（幅 52px）では収まらないので、OS のツールチップ（title）に任せる。

const SHOW_DELAY_MS = 400;
/** 消してからこの時間のうちに別の要素へ移ったら、待たずに出す（行をなぞったとき） */
const WARM_MS = 300;

export interface Tooltips {
  /** 基準の要素が画面から外れていたら消す。描画のあとに呼ぶ */
  prune(): void;
}

export function initTooltips(tip: HTMLElement): Tooltips {
  let current: HTMLElement | undefined;
  let pending: HTMLElement | undefined;
  let timer: number | undefined;
  let hiddenAt = 0;
  /** クリックしたあとは、その要素から離れるまで出さない */
  let suppressed: HTMLElement | undefined;

  // 出している間に中身が変わったら（状態が変わったなど）、すぐ反映する
  const observer = new MutationObserver(() => {
    if (current) tip.textContent = current.dataset.tip ?? '';
  });

  const findTarget = (node: EventTarget | null) =>
    node instanceof Element ? node.closest<HTMLElement>('[data-tip]') ?? undefined : undefined;
  const isCollapsed = () => document.documentElement.classList.contains('collapsed');
  const isResizing = () => document.documentElement.classList.contains('resizing');

  /**
   * anchor-name を付けている要素。消えるアニメーションの間も基準が要るので、current とは別に持ち、次に出すときまで残す
   * （外すと、薄くなっている間だけ基準を失い、ページの上端に出てしまう）
   */
  let anchored: HTMLElement | undefined;

  function show(target: HTMLElement) {
    clearTimeout(timer);
    pending = undefined;
    if (!target.isConnected || !target.dataset.tip) return;
    tip.classList.remove('instant');
    if (anchored !== target) {
      anchored?.style.removeProperty('anchor-name');
      target.style.setProperty('anchor-name', '--tip');
      anchored = target;
    }
    if (current !== target) {
      observer.disconnect();
      observer.observe(target, { attributes: true, attributeFilter: ['data-tip'] });
      current = target;
    }
    tip.textContent = target.dataset.tip;
    if (!tip.matches(':popover-open')) tip.showPopover();
  }

  function hide() {
    clearTimeout(timer);
    pending = undefined;
    if (!current) return;
    observer.disconnect();
    // 基準の要素がもう画面にないときは、薄くしている間に置き場所を失うので、すぐ消す
    tip.classList.toggle('instant', !current.isConnected);
    current = undefined;
    if (tip.matches(':popover-open')) tip.hidePopover();
    hiddenAt = Date.now();
  }

  function schedule(target: HTMLElement) {
    if (target === current || target === pending) return;
    clearTimeout(timer);
    const warm = current !== undefined || Date.now() - hiddenAt < WARM_MS;
    if (warm) {
      show(target);
      return;
    }
    pending = target;
    timer = window.setTimeout(() => show(target), SHOW_DELAY_MS);
  }

  document.addEventListener('pointerover', (e) => {
    const target = findTarget(e.target);
    if (!target || target === suppressed || isResizing()) return;
    if (isCollapsed()) {
      target.title = target.dataset.tip ?? '';
      return;
    }
    target.removeAttribute('title');
    schedule(target);
  });
  document.addEventListener('pointerout', (e) => {
    const from = findTarget(e.target);
    if (!from || findTarget(e.relatedTarget) === from) return;
    if (from === suppressed) suppressed = undefined;
    if (from === current || from === pending) hide();
  });
  document.addEventListener('pointerdown', (e) => {
    suppressed = findTarget(e.target);
    hide();
  });
  document.addEventListener('focusin', (e) => {
    const target = findTarget(e.target);
    if (target && !isCollapsed() && target.matches(':focus-visible')) show(target);
  });
  document.addEventListener('focusout', (e) => {
    if (findTarget(e.target) === current) hide();
  });
  // Esc では popover="hint" が自分で閉じる。そのときも後片付けをする
  tip.addEventListener('toggle', (e) => {
    if ((e as ToggleEvent).newState === 'closed' && current) hide();
  });

  return {
    prune() {
      if (current && !current.isConnected) hide();
      if (pending && !pending.isConnected) hide();
    },
  };
}
