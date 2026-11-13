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
/** これ以下のコミットなら、本文を行の中に出し、下の段は出さない（段のほうが図より大きくなるため） */
const INLINE_MAX = 2;
/** ID を写したことを 2 行目に出しておく長さ */
const COPIED_MS = 1200;

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

/** コミットした日時。その環境の書き方で */
function when(at: number): string {
  return at ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

/** 2 行目。空でない項目を「·」で区切る */
function subLine(parts: string[]): HTMLElement {
  const s = document.createElement('div');
  s.className = 'sub';
  parts.filter(Boolean).forEach((part, i) => {
    if (i) s.append(span('sep', '·'));
    s.append(part);
  });
  return s;
}

/** 図の 1 行。dot は丸の形（commit：塗った丸、head：中が空の丸、wip：点線の中が空の丸、base：◇、none：丸なし） */
function row(dot: 'commit' | 'head' | 'wip' | 'base' | 'none', title: Node[], sub: string[], link: { in?: Link; out?: Link }): HTMLElement {
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
  txt.append(t, subLine(sub));
  el.append(txt);
  return el;
}

/** 見出し：短いブランチ名と、ワークツリーなら分岐元（› main）。カードの見出しにない情報だけを札にする */
function renderHead(head: HTMLElement, d: GitDetail | undefined) {
  if (!d) return head.replaceChildren();
  const name = span('name', d.label ?? d.branch ?? ja.gitDetail.detached);
  if (d.branch) name.title = d.branch;
  const parts: Node[] = [createIcon(d.merged ? 'git-merge' : 'git-branch'), name];
  if (d.mode === 'worktree' && d.base) {
    const to = createIcon('chevron-right');
    to.classList.add('to');
    to.setAttribute('aria-label', ja.gitDetail.fromBase);
    parts.push(to, span('base', d.mergedInto ?? d.base));
  }
  parts.push(span('gap'));
  if (d.merged) parts.push(span('tag', ja.gitDetail.merged));
  else if (d.behind && d.upstream) {
    // 追跡するブランチからの遅れは図に出ないので、札で出す（メインのカードで、取得がオンのときだけ）
    const pill = span('pill');
    pill.append(createIcon('arrow-down'), String(d.behind));
    pill.title = ja.gitDetail.behind(d.upstream, d.behind);
    parts.push(pill);
  }
  head.replaceChildren(...parts);
}

/** コミットの行。題名は種別（と範囲）の札と要約に分ける。押すと短い ID を写す */
function commitRow(c: GitCommit, isHead: boolean, faded: boolean, inline: boolean, link: { in?: Link; out?: Link }, parts: Parts): HTMLElement {
  const title: Node[] = [];
  if (c.type) {
    const tag = span('ctype', c.type);
    if (c.scope) tag.append(span('cscope', c.scope));
    title.push(tag);
  }
  title.push(span('ctext', c.text));
  const el = row(isHead ? 'head' : 'commit', title, [c.short, formatAgo(c.at)], link);
  el.classList.add('git-commit');
  el.tabIndex = 0;
  // ツールチップに件名と本文の全体と日時を出す（下の段と行の中の本文は途中で切ることがあるため）
  const stamp = [when(c.at), isHead ? ja.gitDetail.head : ''].filter(Boolean).join(' · ');
  el.title = [c.subject, ...(c.body ? ['', c.body] : []), '', stamp, ja.gitDetail.copyHint].join('\n');
  el.toggleAttribute('data-faded', faded);
  if (inline && c.body) {
    const body = document.createElement('div');
    body.className = 'cbody';
    body.textContent = c.body;
    el.querySelector('.txt')!.append(body);
  }
  const sub = el.querySelector<HTMLElement>('.sub')!;
  const copied = subLine([ja.gitDetail.copied]);
  copied.classList.add('copied');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const copy = () => {
    window.flyoutApi.copyCommitId(c.short);
    clearTimeout(timer);
    if (sub.isConnected) sub.replaceWith(copied);
    timer = setTimeout(() => copied.replaceWith(sub), COPIED_MS);
  };
  el.addEventListener('click', copy);
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    copy();
  });
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

/** 下の段を出すか。読み込み中と失敗は段で知らせる。コミットが少なければ本文は行の中に出す */
function wantsFoot(d: GitDetail | undefined): boolean {
  return !d || !!d.failed || d.commits.length > INLINE_MAX;
}

/** 下の段。乗せた行のコミットの ID と日時、本文。乗せていなければ全体の件数 */
function showFoot(foot: HTMLElement, c: GitCommit | undefined) {
  if (c && c === footCommit) return;
  footCommit = c;
  const d = current;
  if (foot.hidden) return;
  const b = document.createElement('b');
  if (!c) {
    const hint = span('hint', d?.failed || !d ? '' : ja.gitDetail.hint);
    if (!d) b.textContent = ja.gitDetail.loading;
    else if (d.failed) b.textContent = ja.gitDetail.failed;
    else if (d.mode === 'main') b.textContent = ja.gitDetail.totalRecent(d.commits.length);
    else if (d.merged) b.textContent = ja.gitDetail.totalMerged(d.total);
    else if (!d.total) b.textContent = ja.gitDetail.noCommits(d.base ?? '');
    else b.textContent = ja.gitDetail.totalAhead(d.base ?? '', d.total);
    return foot.replaceChildren(b, hint);
  }
  // 件名は乗せている行に出ているので、ここでは行にない ID と日時を出し、残りの高さを本文に回す
  b.className = 'meta';
  b.textContent = [c.short, when(c.at)].filter(Boolean).join(' · ');
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
  const inline = !wantsFoot(d);
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
  /** i 番目と次の行をつなぐ線。コミットしていない変更、たたんだ行、マージした先の前後は点線 */
  const linkAfter = (i: number): Link | undefined => {
    const a = items[i];
    const b = items[i + 1];
    if (!a || !b) return undefined;
    const loose = (k: Item['kind']) => k === 'fold' || k === 'beyond';
    return a.kind === 'wip' || a.kind === 'merge' || loose(a.kind) || loose(b.kind) ? 'dashed' : 'solid';
  };
  items.forEach((it, i) => {
    const out = linkAfter(i);
    const link = { ...(i > 0 && { in: linkAfter(i - 1) }), ...(out && { out }) };
    if (it.kind === 'wip') {
      const el = row('wip', [document.createTextNode(ja.gitDetail.uncommitted)], [ja.gitDetail.uncommittedParts(d.changed, d.untracked)], link);
      el.addEventListener('pointermove', (e) => {
        if (e.movementX || e.movementY) showFoot(parts.foot, undefined);
      });
      nodes.push(el);
    } else if (it.kind === 'commit') nodes.push(commitRow(it.c, it.head && !d.merged, d.merged, inline, link, parts));
    else if (it.kind === 'fold') nodes.push(foldRow(it.n, parts));
    else if (it.kind === 'beyond') nodes.push(row('none', [document.createTextNode(ja.gitDetail.beyondLimit(it.n, LOG_LIMIT))], [], link));
    else if (it.kind === 'merge') {
      // 図の端の印なので、題名は控えめにして、どこへ入ったかを 2 行目に出す
      nodes.push(row('base', [document.createTextNode(ja.gitDetail.mergedHere)], [d.mergedInto ?? d.base ?? ''], link));
    } else {
      const sub = [d.base ?? '', d.fork ?? '', d.baseAhead && !d.merged ? ja.gitDetail.baseAhead(d.baseAhead) : ''];
      nodes.push(row('base', [document.createTextNode(ja.gitDetail.forkHere)], sub, link));
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
  // 下の段の高さは開いている間は変えない。出すかどうかだけを中身で決める
  parts.foot.hidden = !wantsFoot(detail);
  renderBody(parts);
  showFoot(parts.foot, undefined);
}

/** 一覧から外れたら、下の段を件数に戻す */
export function resetGitFoot(foot: HTMLElement) {
  if (!footCommit) return;
  footCommit = undefined;
  showFoot(foot, undefined);
}

/** 下の段の本文が収まっていなければ、ホイールで本文を送って true を返す（収まっていれば一覧のスクロールに回す） */
export function scrollGitFoot(foot: HTMLElement, deltaY: number): boolean {
  const text = foot.querySelector<HTMLElement>('.summary');
  if (!text || text.scrollHeight <= text.clientHeight) return false;
  text.scrollBy({ top: deltaY });
  return true;
}
