// ツールチップ。data-tip を持つ要素にホバーするか、キーボードでフォーカスしたときに出す。
// title 属性と違い、見た目とアニメーションを CSS で決められる。ウィンドウは 1 つだけで、出すたびに中身と置き場所を差し替える。
// 描くのは別のウィンドウ（tip.html）で、メインプロセスがウィジェットの外の、画面の内側に置く。ほかのセッションの行に重ならない。
// ここでは出す・消すの時機を決め、文字と基準の要素の位置を渡す。

const SHOW_DELAY_MS = 400;
/** 消してからこの時間のうちに別の要素へ移ったら、待たずに出す（行をなぞったとき） */
const WARM_MS = 300;

export interface Tooltips {
  /** 基準の要素が画面から外れていたら消す。描画のあとに呼ぶ */
  prune(): void;
}

export function initTooltips(): Tooltips {
  let current: HTMLElement | undefined;
  let pending: HTMLElement | undefined;
  let timer: number | undefined;
  let hiddenAt = 0;
  /** クリックしたあとは、その要素から離れるまで出さない */
  let suppressed: HTMLElement | undefined;

  // 出している間に中身が変わったら（状態が変わったなど）、すぐ反映する
  const observer = new MutationObserver(() => {
    if (current) send(current);
  });

  const findTarget = (node: EventTarget | null) =>
    node instanceof Element ? node.closest<HTMLElement>('[data-tip]') ?? undefined : undefined;
  const isResizing = () => document.documentElement.classList.contains('resizing');

  function send(target: HTMLElement) {
    const { x, y, width, height } = target.getBoundingClientRect();
    if (target.dataset.tip) window.widget.showTip(target.dataset.tip, { x, y, width, height });
    else window.widget.hideTip();
  }

  function show(target: HTMLElement) {
    clearTimeout(timer);
    pending = undefined;
    if (!target.isConnected || !target.dataset.tip) return;
    if (current !== target) {
      observer.disconnect();
      observer.observe(target, { attributes: true, attributeFilter: ['data-tip'] });
      current = target;
    }
    send(target);
  }

  function hide() {
    clearTimeout(timer);
    pending = undefined;
    if (!current) return;
    observer.disconnect();
    current = undefined;
    window.widget.hideTip();
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
    if (target && target.matches(':focus-visible')) show(target);
  });
  document.addEventListener('focusout', (e) => {
    if (findTarget(e.target) === current) hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  // 基準の要素が動くと置き場所がずれるので消す
  document.addEventListener('scroll', () => hide(), true);
  // ウィンドウの外へ出たとき（pointerout が届かないことがある）
  document.documentElement.addEventListener('pointerleave', () => hide());

  return {
    prune() {
      if (current && !current.isConnected) hide();
      if (pending && !pending.isConnected) hide();
    },
  };
}
