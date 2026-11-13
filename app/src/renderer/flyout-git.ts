// めくれのウィンドウの、git の詳細（docs/design/git-detail.md）。カードの見出しの git の印を押したときに開く。
// 枝の図：上から、コミットしていない変更（点線の丸）→ 分岐元にないコミット（新しい順。HEAD は中が空の丸）→ 分岐元（◇）。
// 線と丸の形はタイムライン（flyout.ts の .node / .dot / .ln）にそろえる。
// コミットの件名と本文はリポジトリから来た文字なので、textContent だけで出す。

import type { GitCommit, GitDetail } from '../shared/types';
import { ja } from '../shared/strings/ja.js';
import { createIcon } from './icon.js';
import { formatAgo } from './model.js';

/** これより多ければ、先頭の 2 件と分岐元のすぐ上の 1 件だけを出し、間をたたむ */
const FOLD_OVER = 8;
/** 並べる上限（src/main/git-detail.ts の LOG_LIMIT と同じ） */
const LOG_LIMIT = 50;

type Link = 'solid' | 'dashed';

interface Parts {
  head: HTMLElement;
  body: HTMLElement;
  foot: HTMLElement;
  /** 中身の高さが変わった（たたんだものを広げた）ときに呼ぶ */
  onResize: () => void;
}

/** たたんだものを広げたか。新しく開いたときに戻す */
let expanded = false;
let current: GitDetail | undefined;
/** 下の段に出しているコミット */
let footCommit: GitCommit | undefined;

function span(className: string, text?: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function line(side: 'in' | 'out', link: Link): HTMLElement {
  return span(`ln ${side} ${link}`);
}

/** 図の 1 行。dot は丸の形（commit：塗った丸、head：中が空の丸、wip：点線の中が空の丸、base：◇） */
function row(dot: 'commit' | 'head' | 'wip' | 'base', title: Node[], sub: string[], link: { in?: Link; out?: Link }): HTMLElement {
  const el = document.createElement('div');
  el.className = 'node linked git-node';
  el.dataset.dot = dot;
  if (link.in) el.append(line('in', link.in));
  if (link.out) el.append(line('out', link.out));
  el.append(span('dot'));
  const txt = document.createElement('div');
  txt.className = 'txt';
  const t = document.createElement('div');
  t.className = 'title';
  t.append(...title);
  const s = document.createElement('div');
  s.className = 'sub';
  sub.forEach((part, i) => {
    if (i) s.append(span('sep', '·'));
    s.append(part);
  });
  txt.append(t, s);
  el.append(txt);
  return el;
}

/** 見出し：ブランチ（マージ済みならマージのアイコン）と、push していない数・遅れの札 */
function renderHead(head: HTMLElement, d: GitDetail | undefined) {
  if (!d) return head.replaceChildren();
  const name = span('name', d.branch ?? ja.gitDetail.detached);
  if (d.branch) name.title = d.branch;
  const parts: Node[] = [createIcon(d.merged ? 'git-merge' : 'git-branch'), name];
  if (d.merged) parts.push(span('tag', ja.gitDetail.merged));
  else {
    if (d.ahead) {
      const pill = span('pill');
      pill.append(createIcon('arrow-up'), String(d.ahead));
      pill.title = d.mode === 'worktree' && d.base ? ja.gitDetail.aheadOfBase(d.base, d.ahead) : ja.gitDetail.unpushed(d.ahead);
      parts.push(pill);
    }
    if (d.behind && d.upstream) {
      const pill = span('pill');
      pill.append(createIcon('arrow-down'), String(d.behind));
      pill.title = ja.gitDetail.behind(d.upstream, d.behind);
      parts.push(pill);
    }
  }
  head.replaceChildren(...parts);
}

/** コミットの行。題名は種別の札と要約に分ける */
function commitRow(c: GitCommit, isHead: boolean, faded: boolean, link: { in?: Link; out?: Link }, parts: Parts): HTMLElement {
  const title: Node[] = [];
  if (c.type) title.push(span('ctype', c.type));
  title.push(span('ctext', c.text));
  const el = row(isHead ? 'head' : 'commit', title, [c.short, formatAgo(c.at)], link);
  el.title = isHead ? `${c.subject}\n${ja.gitDetail.head}` : c.subject;
  el.toggleAttribute('data-faded', faded);
  el.addEventListener('pointermove', (e) => {
    if (e.movementX || e.movementY) showFoot(parts.foot, c);
  });
  return el;
}

/** たたんだ行。押したら全部出す */
function foldRow(n: number, parts: Parts): HTMLElement {
  const el = document.createElement('button');
  el.className = 'node linked git-fold';
  el.title = ja.gitDetail.expand;
  el.append(line('in', 'dashed'), line('out', 'dashed'), span('fold-text', ja.gitDetail.more(n)));
  el.addEventListener('click', () => {
    expanded = true;
    renderBody(parts);
    parts.onResize();
  });
  return el;
}

/** 下の段。乗せた行のコミットの件名と本文、乗せていなければ全体の件数 */
function showFoot(foot: HTMLElement, c: GitCommit | undefined) {
  if (c && c === footCommit) return;
  footCommit = c;
  const d = current;
  if (!c) {
    const b = document.createElement('b');
    const hint = span('hint', d?.failed || !d ? '' : ja.gitDetail.hint);
    if (!d) b.textContent = ja.gitDetail.loading;
    else if (d.failed) b.textContent = ja.gitDetail.failed;
    else if (d.mode === 'main') b.textContent = ja.gitDetail.totalRecent(d.commits.length);
    else if (d.merged) b.textContent = ja.gitDetail.totalMerged(d.total);
    else if (!d.total) b.textContent = ja.gitDetail.noCommits(d.base ?? '');
    else b.textContent = ja.gitDetail.totalAhead(d.base ?? '', d.total);
    return foot.replaceChildren(b, hint);
  }
  const b = document.createElement('b');
  b.textContent = c.subject;
  const text = document.createElement('div');
  text.className = 'summary';
  if (c.body) text.textContent = c.body;
  else text.append(span('hint', ja.gitDetail.noBody));
  foot.replaceChildren(b, text);
}

function renderBody(parts: Parts) {
  const d = current;
  if (!d || d.failed) return parts.body.replaceChildren();
  const nodes: HTMLElement[] = [];
  const faded = d.merged;
  // 上から順に並べる行。線は前の行とつなぐ
  type Item = { kind: 'wip' } | { kind: 'commit'; c: GitCommit; head: boolean } | { kind: 'fold'; n: number } | { kind: 'beyond'; n: number } | { kind: 'merge' } | { kind: 'base' };
  const items: Item[] = [];
  if (d.merged) items.push({ kind: 'merge' });
  if (d.changed || d.untracked) items.push({ kind: 'wip' });
  const all = d.commits;
  const truncated = d.total > all.length;
  if (all.length > FOLD_OVER && !expanded) {
    items.push({ kind: 'commit', c: all[0]!, head: true }, { kind: 'commit', c: all[1]!, head: false });
    if (truncated) items.push({ kind: 'fold', n: d.total - 2 });
    else items.push({ kind: 'fold', n: all.length - 3 }, { kind: 'commit', c: all.at(-1)!, head: false });
  } else {
    all.forEach((c, i) => items.push({ kind: 'commit', c, head: i === 0 }));
    if (truncated) items.push({ kind: 'beyond', n: d.total - all.length });
  }
  if (d.mode === 'worktree') items.push({ kind: 'base' });
  /** i 番目と次の行をつなぐ線。コミットしていない変更とたたんだ行の前後は点線 */
  const linkAfter = (i: number): Link | undefined => {
    const a = items[i];
    const b = items[i + 1];
    if (!a || !b) return undefined;
    return a.kind === 'wip' || a.kind === 'fold' || a.kind === 'beyond' || b.kind === 'fold' || b.kind === 'beyond' || a.kind === 'merge' ? 'dashed' : 'solid';
  };
  items.forEach((it, i) => {
    const link = { ...(i > 0 && { in: linkAfter(i - 1) }), ...(linkAfter(i) && { out: linkAfter(i) }) };
    if (it.kind === 'wip') {
      const el = row('wip', [document.createTextNode(ja.gitDetail.uncommitted)], [ja.gitDetail.uncommittedParts(d.changed, d.untracked)], link);
      el.addEventListener('pointermove', (e) => {
        if (e.movementX || e.movementY) showFoot(parts.foot, undefined);
      });
      nodes.push(el);
    } else if (it.kind === 'commit') nodes.push(commitRow(it.c, it.head && !d.merged, faded, link, parts));
    else if (it.kind === 'fold') nodes.push(foldRow(it.n, parts));
    else if (it.kind === 'beyond') {
      const el = row('commit', [document.createTextNode(ja.gitDetail.beyondLimit(it.n, LOG_LIMIT))], [], link);
      el.dataset.dot = 'none';
      nodes.push(el);
    } else if (it.kind === 'merge') {
      const target = d.mergedInto ?? d.base ?? '';
      nodes.push(row('base', [document.createTextNode(target)], [ja.gitDetail.mergedHere], link));
    } else {
      const sub = [ja.gitDetail.forkHere, ...(d.fork ? [d.fork] : []), ...(d.baseAhead && !d.merged ? [ja.gitDetail.baseAhead(d.baseAhead)] : [])];
      nodes.push(row('base', [document.createTextNode(d.base ?? '')], sub, link));
    }
  });
  parts.body.replaceChildren(...nodes);
}

/** git の詳細を描く。detail がなければ読み込み中。fresh は新しく開いたとき（たたみ直す） */
export function renderGit(detail: GitDetail | undefined, parts: Parts, fresh: boolean) {
  if (fresh) expanded = false;
  current = detail;
  footCommit = undefined;
  parts.head.hidden = !detail;
  renderHead(parts.head, detail);
  renderBody(parts);
  parts.foot.hidden = false;
  showFoot(parts.foot, undefined);
}

/** 一覧から外れたら、下の段を件数に戻す */
export function resetGitFoot(foot: HTMLElement) {
  if (current !== undefined || footCommit) {
    footCommit = undefined;
    showFoot(foot, undefined);
  }
}
