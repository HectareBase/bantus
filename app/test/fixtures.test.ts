// 見本データ（fixtures/*.json）の形と、all-states がすべての状態と分岐を含んでいることを確かめる

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { NO_ARCHIVE, buildRepos, changeItems, WAITING_LABELS, type WorktreeCard } from '../src/renderer/model';
import { readFixture, readFixtureHolds } from '../src/main/sessions';
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
        for (const k of ['hold', 'holdCard']) {
          if (s[k] === undefined) continue;
          assert.equal(typeof s[k].note, 'string', `${s.id}: ${k}.note`);
          assert.equal(typeof s[k].minutesAgo, 'number', `${s.id}: ${k}.minutesAgo`);
        }
      }
    });
  }
});

describe('all-states はすべての表示を含む', () => {
  const now = Date.now();
  const sessions = readFixture(join(FIXTURES, 'all-states.json'), now, 0);
  const { holds, heldCards } = readFixtureHolds(join(FIXTURES, 'all-states.json'), now);
  const repos = buildRepos(sessions, { ...NO_ARCHIVE, now, mainMinutes: 10, holds, heldCards });
  const cards = repos.flatMap((r) => [...r.cards, ...r.hiddenCards]);
  const has = (test: (c: WorktreeCard) => boolean, what: string) => assert.ok(cards.some(test), what);

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

  it('カードとアーカイブの種類', () => {
    assert.ok(repos.some((r) => r.cards.some((c) => c.isMain) && r.cards.some((c) => !c.isMain)), 'main とワークツリーの両方');
    assert.ok(repos.some((r) => r.cards.length > 0 && r.cards.every((c) => !c.isMain)), 'ワークツリーだけ');
    assert.ok(repos.some((r) => r.cards.length > 0 && r.cards.every((c) => c.isMain)), 'main だけ');
    has((c) => !c.isMain && c.sessions.length > 1, '同じワークツリーで複数が動いている');
    has((c) => !c.isMain && c.archived.length > 1, 'ワークツリーのアーカイブ（重なり）');
    has((c) => c.isMain && c.archived.length > 0, 'main のアーカイブ');
    has((c) => c.timeline.some((t) => t.origin), '起点');
    has((c) => c.timeline.some((t) => t.link === 'solid') && c.timeline.some((t) => t.link === 'dashed'), '実線と破線');
    has((c) => c.hidden && !!c.changes?.merged, 'マージ済みのカード');
    has((c) => c.hidden && !!c.changes?.gone, 'ワークツリーがないカード');
    assert.ok(sessions.some((s) => s.summary), '最後のターンのまとめ');
    assert.ok(sessions.some((s) => !s.mainBranch && !s.worktree), 'main のブランチ不明');
  });

  it('保留の行と保留のカード（メモあり・なし）', () => {
    const heldRows = cards.flatMap((c) => c.sessions).filter((s) => holds[s.id]);
    assert.ok(heldRows.some((s) => holds[s.id]!.note) && heldRows.some((s) => !holds[s.id]!.note), '保留の行');
    const heldShown = cards.filter((c) => c.held && !c.hidden);
    assert.ok(heldShown.some((c) => c.held!.note) && heldShown.some((c) => !c.held!.note), '保留のカード');
    assert.ok(repos.some((r) => r.badge.state === 'held'), '保留のバッジ');
    assert.ok(sessions.every((s) => !('hold' in s) && !('holdCard' in s)), '見本の保留の項目はセッションに入れない');
  });

  it('git の印の種類', () => {
    assert.ok(sessions.some((s) => changeItems(s.changes).length === 4), '4 種類すべて');
    assert.ok(sessions.some((s) => s.changes && !s.changes.changed && !s.changes.untracked && s.changes.ahead > 0), 'push していないコミットだけ');
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
