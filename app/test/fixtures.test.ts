// 見本データ（fixtures/*.json）の形と、all-states がすべての状態と分岐を含んでいることを確かめる

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildCards, buildGroups, cardLayout, changeCount, changeItems, WAITING_LABELS, type Card } from '../src/renderer/model';
import { readFixture } from '../src/main/sessions';
import type { SessionState } from '../src/shared/types';
import { FIXTURES } from './helpers';

const STATES: SessionState[] = ['waiting', 'busy', 'idle', 'stopped'];
const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.json'));

describe('見本データの形', () => {
  for (const file of files) {
    it(file, () => {
      const items = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
      assert.ok(Array.isArray(items));
      const ids = new Set<string>();
      for (const s of items) {
        assert.match(s.id, /^local_/, `${s.id}: ID は local_ から始める`);
        assert.ok(!ids.has(s.id), `${s.id}: ID が重複している`);
        ids.add(s.id);
        assert.equal(typeof s.title, 'string');
        assert.equal(typeof s.repoKey, 'string');
        assert.equal(typeof s.repoName, 'string');
        assert.ok(STATES.includes(s.state), `${s.id}: 状態 ${s.state}`);
        assert.equal(typeof s.minutesAgo, 'number', `${s.id}: minutesAgo`);
        if (s.waitingFor !== undefined) assert.equal(s.state, 'waiting', `${s.id}: waitingFor は対応待ちのときだけ`);
        if (s.worktree) for (const k of ['key', 'label', 'branch']) assert.equal(typeof s.worktree[k], 'string');
        if (s.changes) for (const k of ['changed', 'untracked', 'ahead']) assert.equal(typeof s.changes[k], 'number', `${s.id}: changes.${k}`);
      }
    });
  }
});

describe('all-states はすべての表示を含む', () => {
  const sessions = readFixture(join(FIXTURES, 'all-states.json'), Date.now(), 0);
  const cards = buildCards(sessions);
  const has = (test: (c: Card) => boolean, what: string) => assert.ok(cards.some(test), what);

  it('すべての状態', () => assert.deepEqual(STATES.filter((st) => !sessions.some((s) => s.state === st)), []));

  it('すべての対応待ちの理由と、知らない理由、理由なし', () => {
    const reasons = new Set(sessions.filter((s) => s.state === 'waiting').map((s) => s.waitingFor));
    for (const known of Object.keys(WAITING_LABELS)) assert.ok(reasons.has(known), known);
    assert.ok([...reasons].some((r) => r !== undefined && !(r in WAITING_LABELS)), '知らない理由');
    assert.ok(reasons.has(undefined), '理由なし');
  });

  it('対応が必要とまとめ', () => {
    assert.ok(sessions.some((s) => s.needsAction));
    assert.ok(sessions.some((s) => s.detail));
  });

  it('カードと小見出しの種類', () => {
    const groups = (c: Card) => buildGroups(c.active);
    has((c) => groups(c).some((g) => !g.isMain) && groups(c).some((g) => g.isMain), 'メインとワークツリーの両方');
    has((c) => groups(c).length > 0 && groups(c).every((g) => !g.isMain), 'ワークツリーだけ');
    has((c) => groups(c).length > 0 && groups(c).every((g) => g.isMain), '小見出しなし');
    has((c) => c.active.length === 0 && c.stopped.length > 0, '停止中だけ');
    has((c) => groups(c).some((g) => !g.isMain && g.sessions.length > 1), '同じワークツリーに複数');
    has((c) => c.active.some((s) => !s.mainBranch && !s.worktree), 'メインのブランチ不明');
    has((c) => c.stopped.some((s) => s.worktree !== undefined), '停止中のワークツリー');
  });

  it('コミットされていない変更の出る場所（小見出し、見出し、折りたたみ）と、内訳の種類', () => {
    has((c) => buildGroups(c.active).some((g) => changeItems(g.changes).length > 0), '小見出し');
    has((c) => changeItems(cardLayout(c).headerChanges).length > 0, '見出し');
    has((c) => (cardLayout(c).fold?.changedFolders ?? 0) > 0, '折りたたみ');
    assert.ok(sessions.some((s) => changeItems(s.changes).length === 3), '3 種類すべて');
    assert.ok(sessions.some((s) => s.changes && !changeCount(s.changes) && s.changes.ahead > 0), 'push していないコミットだけ');
  });

  it('時刻の表示の種類（たった今、分、時間、日）', () => {
    const now = Date.now();
    const mins = sessions.map((s) => (now - s.lastActivityAt) / 60_000);
    assert.ok(mins.some((m) => m < 1));
    assert.ok(mins.some((m) => m >= 1 && m < 60));
    assert.ok(mins.some((m) => m >= 60 && m < 1440));
    assert.ok(mins.some((m) => m >= 1440));
  });
});
