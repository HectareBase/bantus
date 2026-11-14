// プロジェクトの ToDo（docs/design/todos.md）の読み書き。保存先は settings.json と同じフォルダの todos.json で、
// Claude のデータには書かない。ファイルのパスを受け取る形にして、Electron なしで試せるようにする（test/todo-store.test.ts）。
// - 一時ファイル（todos.json.tmp）に書いてから置き換える。途中で止まっても元のファイルは壊れない
// - 読めなかったファイルは todos.json.bad に移してから空で動く（次に書いたときに消えないように）

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { normalizeTodos, withTodoList, type TodoItem, type TodoStore } from '../shared/todos';

export const TODO_FILE = 'todos.json';

/** settings.json と同じフォルダの todos.json */
export function todoFilePath(dataDir: string): string {
  return join(dataDir, TODO_FILE);
}

function keepBadFile(path: string) {
  try {
    renameSync(path, `${path}.bad`);
  } catch {
    try {
      copyFileSync(path, `${path}.bad`);
    } catch {
      // 残せなくても、空で動く
    }
  }
}

/** ファイルを読む。ないときは空。壊れているときは .bad に移して空 */
export function readTodoFile(path: string): TodoStore {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') keepBadFile(path);
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    keepBadFile(path);
    return {};
  }
  return normalizeTodos(parsed);
}

/** 一時ファイルに書いてから置き換える。置き換えられなければ、じかに書く */
export function writeTodoFile(path: string, store: TodoStore) {
  mkdirSync(dirname(path), { recursive: true });
  const text = JSON.stringify(store, null, 2);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  try {
    renameSync(tmp, path);
  } catch {
    writeFileSync(path, text);
    rmSync(tmp, { force: true });
  }
}

export interface TodoStoreFile {
  /** 全部のプロジェクトの ToDo */
  all(): TodoStore;
  /** 1 つのプロジェクトの並びを置き換えて保存する。そろえたあとの並びを返す */
  set(key: string, list: unknown): TodoItem[];
}

/** 読んだ中身を覚えておき、変えるたびに書く。書けなくても、起動している間は新しい中身で動く */
export function createTodoStore(path: string, seed?: () => TodoStore): TodoStoreFile {
  let store: TodoStore | undefined;
  const load = (): TodoStore => {
    if (!store) {
      const fresh = !existsSync(path);
      store = readTodoFile(path);
      // 見本データの ToDo は、ファイルがまだないときだけ入れる（消したものが起動のたびに戻らないように）
      if (fresh && seed) store = normalizeTodos(seed());
    }
    return store;
  };
  return {
    all: () => load(),
    set(key, list) {
      store = withTodoList(load(), key, list);
      try {
        writeTodoFile(path, store);
      } catch {
        // 保存に失敗しても、今の起動中は新しい中身で動く
      }
      return store[key] ?? [];
    },
  };
}
