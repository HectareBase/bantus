// プロジェクトの ToDo（docs/design/todos.md）の形と、そろえる・畳むの判定。メインプロセスと画面の両方から使う純粋な関数だけを置く。

/** ToDo の 1 件。id はプロジェクトの中で重ならない文字（画面で行を見分けるのに使う） */
export interface TodoItem {
  id: string;
  text: string;
}

/** プロジェクトの目印（RepoView.key。リポジトリのフォルダのパスをそろえたもの） → ToDo の並び */
export type TodoStore = Record<string, TodoItem[]>;

/** 1 件の文字の長さの上限 */
export const TODO_TEXT_MAX = 120;
/** 1 つのプロジェクトに持てる件数の上限（壊れたファイルや送り間違いで膨らまないように） */
export const TODO_LIMIT = 200;
/** この件数から畳む */
export const TODO_FOLD_AT = 5;
/** 畳んでいるときに出す件数 */
export const TODO_FOLD_SHOW = 3;
/** チェックしてから消えるまで（ms）。この間にチェックを外すと取り消せる */
export const TODO_LEAVE_MS = 2500;

/** 文字をそろえる：改行とタブは空白にし、前後の空白を落とし、上限で切る */
export function normalizeTodoText(text: string): string {
  return [...text.replace(/[\r\n\t]+/g, ' ').trim()].slice(0, TODO_TEXT_MAX).join('').trim();
}

/** 1 つのプロジェクトの並びをそろえる。形の合わないもの、空の文字は捨て、重なった id は付け直す */
export function normalizeTodoList(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return [];
  const out: TodoItem[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (out.length >= TODO_LIMIT) break;
    if (!item || typeof item !== 'object') continue;
    const { id, text } = item as Record<string, unknown>;
    if (typeof text !== 'string') continue;
    const clean = normalizeTodoText(text);
    if (!clean) continue;
    let key = typeof id === 'string' && id && id.length <= 64 ? id : '';
    if (!key || seen.has(key)) key = newTodoId(seen);
    seen.add(key);
    out.push({ id: key, text: clean });
  }
  return out;
}

/** ファイル全体をそろえる。オブジェクトでなければ空。空になったプロジェクトは持たない */
export function normalizeTodos(value: unknown): TodoStore {
  const out: TodoStore = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, list] of Object.entries(value)) {
    if (!key) continue;
    const items = normalizeTodoList(list);
    if (items.length) out[key] = items;
  }
  return out;
}

/** taken と重ならない新しい id */
export function newTodoId(taken: Iterable<string> = []): string {
  const used = new Set(taken);
  for (;;) {
    const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    if (!used.has(id)) return id;
  }
}

/** 1 つのプロジェクトの並びを置き換えたストア。空なら、そのプロジェクトを消す */
export function withTodoList(store: TodoStore, key: string, list: unknown): TodoStore {
  const next = { ...store };
  const items = normalizeTodoList(list);
  if (items.length) next[key] = items;
  else delete next[key];
  return next;
}

export interface TodoFold {
  /** 「ほか N 件」「畳む」のボタンを出すか（TODO_FOLD_AT 件以上） */
  foldable: boolean;
  /** 畳んでいる（最初の TODO_FOLD_SHOW 件だけを出している） */
  folded: boolean;
  /** 出す件数 */
  shown: number;
  /** 畳んで隠している件数（「ほか N 件」） */
  rest: number;
}

/** count 件のとき、開いているか（open）に応じて、何件を出すか */
export function todoFold(count: number, open: boolean): TodoFold {
  const foldable = count >= TODO_FOLD_AT;
  const folded = foldable && !open;
  const shown = folded ? TODO_FOLD_SHOW : count;
  return { foldable, folded, shown, rest: count - shown };
}
