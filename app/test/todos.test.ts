// プロジェクトの ToDo（docs/design/todos.md）：形のそろえ方、畳む件数、todos.json の読み書き、見本データ
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createTodoStore, readTodoFile, todoFilePath, writeTodoFile } from '../src/main/todo-store';
import { readFixtureTodos } from '../src/main/sessions';
import {
  TODO_FOLD_AT,
  TODO_FOLD_SHOW,
  TODO_LIMIT,
  TODO_TEXT_MAX,
  newTodoId,
  normalizeTodoList,
  normalizeTodoText,
  normalizeTodos,
  todoFold,
  withTodoList,
} from '../src/shared/todos';
import { FIXTURES, tempDir, writeJson } from './helpers';

describe('ToDo の文字', () => {
  it('前後の空白を落とし、改行とタブは空白にする', () => {
    assert.equal(normalizeTodoText('  a\r\nb\tc  '), 'a b c');
    assert.equal(normalizeTodoText('   '), '');
  });
  it('上限で切る（サロゲートペアを割らない）', () => {
    assert.equal([...normalizeTodoText('あ'.repeat(TODO_TEXT_MAX + 10))].length, TODO_TEXT_MAX);
    const emoji = normalizeTodoText('😀'.repeat(TODO_TEXT_MAX + 1));
    assert.equal([...emoji].length, TODO_TEXT_MAX);
    assert.ok([...emoji].every((c) => c === '😀'));
  });
});

describe('ToDo の並びのそろえ方', () => {
  it('形の合わないものと空の文字を捨てる', () => {
    const list = normalizeTodoList([{ id: 'a', text: 'x' }, null, 3, { id: 'b' }, { id: 'c', text: '  ' }, { id: 'd', text: 'y' }]);
    assert.deepEqual(list, [
      { id: 'a', text: 'x' },
      { id: 'd', text: 'y' },
    ]);
  });
  it('id がないもの、重なったものは付け直す', () => {
    const list = normalizeTodoList([{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }, { text: 'z' }]);
    assert.equal(list.length, 3);
    assert.equal(new Set(list.map((t) => t.id)).size, 3);
    assert.equal(list[0]!.id, 'a');
  });
  it('件数の上限で切る', () => {
    const many = Array.from({ length: TODO_LIMIT + 5 }, (_, i) => ({ id: `t${i}`, text: `x${i}` }));
    assert.equal(normalizeTodoList(many).length, TODO_LIMIT);
  });
  it('配列でなければ空', () => assert.deepEqual(normalizeTodoList('x'), []));
  it('ファイル全体：オブジェクトでなければ空、空になったプロジェクトは持たない', () => {
    assert.deepEqual(normalizeTodos(null), {});
    assert.deepEqual(normalizeTodos([1]), {});
    assert.deepEqual(normalizeTodos({ a: [{ id: '1', text: 'x' }], b: [], c: 'x' }), { a: [{ id: '1', text: 'x' }] });
  });
  it('1 つのプロジェクトを置き換える。空にしたら消す', () => {
    const store = { a: [{ id: '1', text: 'x' }], b: [{ id: '2', text: 'y' }] };
    assert.deepEqual(withTodoList(store, 'a', [{ id: '3', text: 'z' }]).a, [{ id: '3', text: 'z' }]);
    assert.deepEqual(Object.keys(withTodoList(store, 'a', [])), ['b']);
    // 元のものは変えない
    assert.equal(store.a.length, 1);
  });
  it('新しい id は重ならない', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = newTodoId(taken);
      assert.ok(!taken.has(id));
      taken.add(id);
    }
  });
});

describe('畳む件数', () => {
  it(`${TODO_FOLD_AT} 件より少なければ畳まない`, () => {
    for (let n = 0; n < TODO_FOLD_AT; n++) {
      assert.deepEqual(todoFold(n, false), { foldable: false, folded: false, shown: n, rest: 0 });
      assert.deepEqual(todoFold(n, true), { foldable: false, folded: false, shown: n, rest: 0 });
    }
  });
  it(`${TODO_FOLD_AT} 件から、閉じているときは ${TODO_FOLD_SHOW} 件だけを出す`, () => {
    assert.deepEqual(todoFold(TODO_FOLD_AT, false), { foldable: true, folded: true, shown: TODO_FOLD_SHOW, rest: TODO_FOLD_AT - TODO_FOLD_SHOW });
    assert.deepEqual(todoFold(9, false), { foldable: true, folded: true, shown: TODO_FOLD_SHOW, rest: 9 - TODO_FOLD_SHOW });
  });
  it('開いているときは全部を出す', () => {
    assert.deepEqual(todoFold(9, true), { foldable: true, folded: false, shown: 9, rest: 0 });
  });
});

describe('todos.json の読み書き', () => {
  it('settings.json と同じフォルダに置く', () => {
    assert.equal(todoFilePath(join('x', 'data')), join('x', 'data', 'todos.json'));
  });
  it('ないときは空で、.bad も作らない', () => {
    const dir = tempDir();
    try {
      const path = todoFilePath(dir.path);
      assert.deepEqual(readTodoFile(path), {});
      assert.equal(existsSync(`${path}.bad`), false);
    } finally {
      dir.cleanup();
    }
  });
  it('壊れたファイルは .bad に移して空で動く', () => {
    const dir = tempDir();
    try {
      const path = todoFilePath(dir.path);
      writeJson(path, '{ broken');
      assert.deepEqual(readTodoFile(path), {});
      assert.equal(readFileSync(`${path}.bad`, 'utf8'), '{ broken');
      writeJson(path, '[1, 2]');
      assert.deepEqual(readTodoFile(path), {});
    } finally {
      dir.cleanup();
    }
  });
  it('書いたものを読める。一時ファイルは残らない', () => {
    const dir = tempDir();
    try {
      const path = todoFilePath(join(dir.path, 'nested'));
      const store = { 'c:/repo': [{ id: 'a', text: 'やること' }] };
      writeTodoFile(path, store);
      assert.deepEqual(readTodoFile(path), store);
      assert.equal(existsSync(`${path}.tmp`), false);
    } finally {
      dir.cleanup();
    }
  });
  it('置き換えるたびに保存し、読み直しても同じ', () => {
    const dir = tempDir();
    try {
      const path = todoFilePath(dir.path);
      const store = createTodoStore(path);
      assert.deepEqual(store.all(), {});
      const saved = store.set('c:/repo', [{ id: 'a', text: '  x  ' }, { text: '' }]);
      assert.deepEqual(saved, [{ id: 'a', text: 'x' }]);
      store.set('c:/other', [{ id: 'b', text: 'y' }]);
      store.set('c:/other', []);
      assert.deepEqual(readTodoFile(path), { 'c:/repo': [{ id: 'a', text: 'x' }] });
      assert.deepEqual(createTodoStore(path).all(), { 'c:/repo': [{ id: 'a', text: 'x' }] });
    } finally {
      dir.cleanup();
    }
  });
  it('見本の ToDo は、ファイルがまだないときだけ入れる', () => {
    const dir = tempDir();
    try {
      const path = todoFilePath(dir.path);
      const seed = () => ({ r: [{ id: 's', text: '見本' }] });
      const first = createTodoStore(path, seed);
      assert.deepEqual(first.all(), { r: [{ id: 's', text: '見本' }] });
      first.set('r', []);
      assert.deepEqual(createTodoStore(path, seed).all(), {});
    } finally {
      dir.cleanup();
    }
  });
});

describe('見本データの ToDo', () => {
  const todos = readFixtureTodos(join(FIXTURES, 'all-states.json'));
  it('畳まないプロジェクトと、畳むプロジェクトがある', () => {
    const counts = Object.values(todos).map((l) => l.length);
    assert.ok(counts.some((n) => n > 0 && n < TODO_FOLD_AT), '畳まない');
    assert.ok(counts.some((n) => n >= TODO_FOLD_AT), '畳む');
  });
  it('そろえても変わらない形をしている', () => {
    for (const list of Object.values(todos)) assert.deepEqual(normalizeTodoList(list), list);
  });
});
