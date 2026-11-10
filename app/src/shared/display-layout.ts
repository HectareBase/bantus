// ウィジェットを出すモニターを、モニターの接続状態（構成）ごとに覚える。
// ノート PC で外部モニターを外す・つなぐたびに、その構成で前に選んだモニターへ戻すための判定をここに集める（Electron に頼らない純粋な関数）。
//
// モニターの見分け方：Electron の Display.id は Windows では GDI のデバイス名（\\.\DISPLAY1 など）から作られ、
// 抜き差しや再起動で番号が入れ替わることがある。そこで、id ではなく次を並べた「しるし」を使う。
//   - 内蔵の画面（internal）は 'internal'、それ以外はモニターの名前（label。Windows では EDID の製品名）
//   - 物理の解像度（size × scaleFactor。縦置きでも同じになるよう、長い辺 × 短い辺にそろえる）
// 同じ型のモニターが 2 台あるときは、左上から並べた順に「#2」「#3」をつけて分ける。

/** 判定に使うモニターの情報。Electron の Display の一部 */
export interface MonitorInfo {
  id: number;
  label: string;
  internal: boolean;
  size: { width: number; height: number };
  scaleFactor: number;
  bounds: { x: number; y: number };
}

/** 選択の値。'primary' は Windows のメインのモニター（メインを変えるとついていく） */
export const PRIMARY = 'primary';

/** 覚えておく構成の数の上限。超えたら古く選んだものから捨てる */
export const LAYOUT_MEMORY_MAX = 32;

/** モニター 1 台のしるし（同じ型が並ぶときの番号はつけない） */
function baseSignature(m: MonitorInfo): string {
  const name = m.internal ? 'internal' : m.label.trim() || 'display';
  const sf = m.scaleFactor > 0 ? m.scaleFactor : 1;
  const w = Math.round(m.size.width * sf);
  const h = Math.round(m.size.height * sf);
  return `${name}@${Math.max(w, h)}x${Math.min(w, h)}`;
}

/** それぞれのモニターのしるし。並びは入力と同じ */
export function monitorSignatures(monitors: MonitorInfo[]): string[] {
  const order = monitors.map((m, i) => ({ m, i })).sort((a, b) => a.m.bounds.x - b.m.bounds.x || a.m.bounds.y - b.m.bounds.y);
  const out: string[] = monitors.map(() => '');
  const seen = new Map<string, number>();
  for (const { m, i } of order) {
    const base = baseSignature(m);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out[i] = n === 1 ? base : `${base}#${n}`;
  }
  return out;
}

/** モニターとそのしるしの組 */
function withSignatures(monitors: MonitorInfo[]): { m: MonitorInfo; sig: string }[] {
  const sigs = monitorSignatures(monitors);
  return monitors.map((m, i) => ({ m, sig: sigs[i] ?? '' }));
}

/** 構成のキー。つないでいるモニターのしるしを並べ替えてつなぐので、並びや id が変わっても同じになる */
export function layoutKey(monitors: MonitorInfo[]): string {
  return [...monitorSignatures(monitors)].sort().join(' + ');
}

export interface DisplayMemory {
  /** 古い版の単一の設定。覚えのない構成で使う（ふつうは 'primary'） */
  display: string;
  /** 構成のキー → 選んだモニター（'primary' かモニターのしるし） */
  displayByLayout: Record<string, string>;
}

/** 今の構成で使う選択。覚えがなければ古い単一の設定 */
export function currentChoice(mem: DisplayMemory, monitors: MonitorInfo[]): string {
  return mem.displayByLayout[layoutKey(monitors)] ?? mem.display;
}

/**
 * 選択に合うモニターの id。'primary'、しるし、古い版の id（数字の文字列）の順に探し、見つからなければメインのモニター
 */
export function pickMonitor(choice: string, monitors: MonitorInfo[], primaryId: number): number {
  if (choice === PRIMARY) return primaryId;
  const bySig = withSignatures(monitors).find((x) => x.sig === choice);
  if (bySig) return bySig.m.id;
  const byId = monitors.find((m) => String(m.id) === choice);
  return byId ? byId.id : primaryId;
}

/** 今の構成に選択を結びつけた設定。選び直した構成は一番新しいものとして後ろへ回し、上限を超えた古い構成は捨てる */
export function rememberChoice(mem: DisplayMemory, monitors: MonitorInfo[], choice: string): DisplayMemory {
  const key = layoutKey(monitors);
  const rest = Object.entries(mem.displayByLayout).filter(([k]) => k !== key);
  const kept = rest.slice(Math.max(0, rest.length - (LAYOUT_MEMORY_MAX - 1)));
  return { display: PRIMARY, displayByLayout: Object.fromEntries([...kept, [key, choice]]) };
}

/**
 * 古い版の単一の設定（モニターの id）を、今の構成の覚えに移す。
 * その id のモニターが今つながっているときだけ移し、移したら単一の設定は 'primary' に戻す。移すものがなければ undefined
 */
export function migrateLegacyDisplay(mem: DisplayMemory, monitors: MonitorInfo[]): DisplayMemory | undefined {
  if (mem.display === PRIMARY) return undefined;
  const key = layoutKey(monitors);
  if (key in mem.displayByLayout) return undefined;
  const found = withSignatures(monitors).find((x) => String(x.m.id) === mem.display);
  return found ? rememberChoice(mem, monitors, found.sig) : undefined;
}

/**
 * 設定画面の選択肢の値。メインのモニターは 'primary'、ほかはしるし。
 * selected は今の構成の選択を選択肢のどれかに合わせたもの（合わなければ、実際に使うモニターの選択肢）
 */
export function displayChoices(mem: DisplayMemory, monitors: MonitorInfo[], primaryId: number): { values: { id: number; value: string }[]; selected: string } {
  const values = [
    { id: primaryId, value: PRIMARY },
    ...withSignatures(monitors).flatMap(({ m, sig }) => (m.id === primaryId ? [] : [{ id: m.id, value: sig }])),
  ];
  const choice = currentChoice(mem, monitors);
  if (values.some((v) => v.value === choice)) return { values, selected: choice };
  const used = pickMonitor(choice, monitors, primaryId);
  return { values, selected: values.find((v) => v.id === used)?.value ?? PRIMARY };
}

/** 保存されていた構成ごとの覚えを確かめる。文字列でないものは捨て、多すぎれば新しいほうを残す */
export function normalizeDisplayByLayout(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const entries = Object.entries(input as Record<string, unknown>).filter(
    (e): e is [string, string] => e[0].length > 0 && e[0].length <= 1000 && typeof e[1] === 'string' && e[1].length > 0 && e[1].length <= 300,
  );
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - LAYOUT_MEMORY_MAX)));
}

/** つないだ・外した直後に、落ち着いたころ読み直すまでの間（ms） */
export const DISPLAY_SETTLE_MS = [500, 2_000];
/** スタンバイからの復帰やロックの解除のあと、読み直すまでの間（ms）。モニターがつながり直すのを何度か待つ */
export const RESUME_SETTLE_MS = [1_000, 3_000, 8_000];

/**
 * 間をあけて何度か run を呼ぶ。呼ぶたびに前の予定を取り消して数え直す（続けて起きた変化を 1 回にまとめる）
 */
export function settleTimers(run: () => void, timers: { set: typeof setTimeout; clear: typeof clearTimeout } = { set: setTimeout, clear: clearTimeout }) {
  let pending: ReturnType<typeof setTimeout>[] = [];
  return (delays: number[]) => {
    for (const t of pending) timers.clear(t);
    pending = delays.map((ms) => timers.set(run, ms));
  };
}
