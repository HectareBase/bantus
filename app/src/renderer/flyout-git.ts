// めくれのウィンドウの、git の詳細（docs/design/git-detail.md）。カードの見出しの git の印を押したときに開く。
// 枝の図：上から、コミットしていない変更（点線の丸）→ 分岐元にないコミット（新しい順。HEAD は中が空の丸）→ 分岐元（◇）。
// 線と丸の形はタイムライン（flyout.ts の .node / .dot / .ln）にそろえる。
// コミットの件名と本文はリポジトリから来た文字なので、textContent だけで出す。

import type { GitCommit, GitDetail, GitMerge } from '../shared/types';
import { mergeCountLabel, mergeHeadline } from '../shared/git-merge.js';
import { ja } from '../shared/strings/ja.js';
import { createIcon } from './icon.js';
import { formatAgo } from './model.js';

/** これより多ければ、先頭の 2 件と分岐元のすぐ上の 1 件だけを出し、間をたたむ */
const FOLD_OVER = 8;
/** 並べる上限（src/main/git-detail.ts の LOG_LIMIT と同じ） */
const LOG_LIMIT = 50;
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
/** 取り込んだコミットを開いたマージ（短い ID）。ポップアップを開いている間だけ覚える */
const openMerges = new Set<string>();
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

/** 2 行目。空でない項目を「·」で区切る。札（要素）の後ろには区切りを置かない */
function subLine(parts: (string | Node)[]): HTMLElement {
  const s = document.createElement('div');
  s.className = 'sub';
  let prevText = false;
  for (const part of parts.filter(Boolean)) {
    const text = typeof part === 'string';
    if (text && prevText) s.append(span('sep', '·'));
    s.append(part);
    prevText = text;
  }
  return s;
}

/** 図の 1 行。dot は丸の形（commit：塗った丸、head：中が空の丸、wip：点線の中が空の丸、base：◇、none：丸なし） */
function row(dot: 'commit' | 'head' | 'wip' | 'base' | 'none', title: Node[], sub: (string | Node)[], link: { in?: Link; out?: Link }): HTMLElement {
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
  // 比べている先（ワークツリーは分岐元、メインのカードは追跡するブランチ）。一番下の ◇ と同じもの
  const against = d.mode === 'worktree' ? d.mergedInto ?? d.base : d.tracking;
  if (against) {
    const to = createIcon('chevron-right');
    to.classList.add('to');
    to.setAttribute('aria-label', ja.gitDetail.fromBase);
    parts.push(to, span('base', against));
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

/** 種別（と範囲）の札。マージは「マージ」の札 */
function typeTag(c: GitCommit): HTMLElement | undefined {
  if (c.merge) return span('ctype mtag', ja.gitDetail.mergeTag);
  if (!c.type) return undefined;
  const tag = span('ctype', c.type);
  if (c.scope) tag.append(span('cscope', c.scope));
  return tag;
}

/** 行に出す文。マージはセッションのタイトルかブランチ名、分岐元を取り込んだものは「<分岐元> を取り込み」 */
function commitText(c: GitCommit): string {
  const m = c.merge;
  if (!m) return c.text;
  if (m.fromBase) return ja.gitDetail.mergeOf(m.name ?? current?.base ?? c.text);
  return mergeHeadline(m, c.text);
}

/**
 * コミットの行に、押すと短い ID を写す働きと、乗せると下の段に本文を出す働きを付ける。
 * 写したことは feedback（2 行目、子の行では 1 行目）を少しのあいだ差し替えて知らせる
 */
function makeCopyable(el: HTMLElement, c: GitCommit, isHead: boolean, feedback: HTMLElement, parts: Parts) {
  el.classList.add('git-commit');
  el.tabIndex = 0;
  // ツールチップに件名と本文の全体と日時を出す（下の段と行の中の本文は途中で切ることがあるため）
  const stamp = [when(c.at), isHead ? ja.gitDetail.head : ''].filter(Boolean).join(' · ');
  el.title = [c.subject, ...(c.body ? ['', c.body] : []), '', stamp, ja.gitDetail.copyHint].join('\n');
  const copied = feedback.classList.contains('sub') ? subLine([ja.gitDetail.copied]) : span('ctext', ja.gitDetail.copied);
  copied.classList.add('copied');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const copy = () => {
    window.flyoutApi.copyCommitId(c.short);
    clearTimeout(timer);
    if (feedback.isConnected) feedback.replaceWith(copied);
    timer = setTimeout(() => copied.replaceWith(feedback), COPIED_MS);
  };
  el.addEventListener('click', copy);
  el.addEventListener('keydown', (e) => {
    if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    copy();
  });
  el.addEventListener('pointermove', (e) => {
    if (e.movementX || e.movementY) showFoot(parts.foot, c);
  });
}

/** マージの取り込んだコミットを開け閉めするトグル（›N）。2 行目の右に置く */
function mergeToggle(c: GitCommit, m: GitMerge, parts: Parts): HTMLElement {
  const open = openMerges.has(c.short);
  const btn = document.createElement('button');
  btn.className = 'git-toggle';
  btn.setAttribute('aria-expanded', String(open));
  btn.title = open ? ja.gitDetail.hideMerged : ja.gitDetail.showMerged;
  btn.append(createIcon(open ? 'chevron-up' : 'chevron-down'), mergeCountLabel(m));
  // 行を押すと ID を写すので、トグルの押下は行へ伝えない
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (open) openMerges.delete(c.short);
    else openMerges.add(c.short);
    renderBody(parts);
    parts.onResize();
    parts.body.querySelector<HTMLElement>(`.git-toggle[data-id="${c.short}"]`)?.focus();
  });
  // Enter／Space は行の「ID を写す」に回さない。Esc などほかのキーは通す（一覧を閉じるため）
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
  });
  btn.dataset.id = c.short;
  return btn;
}

/**
 * コミットの行。1 行目は要約だけにして、どの行も文の頭をそろえる。種別（と範囲）の札は 2 行目の頭に置く
 * （1 行目に置くと、札の幅で文の頭がずれるため）。押すと短い ID を写す。
 * マージは二重の丸と「マージ」の札にし、取り込んだコミットがあれば 2 行目の右にトグルを置く
 */
function commitRow(c: GitCommit, isHead: boolean, faded: boolean, link: { in?: Link; out?: Link }, parts: Parts): HTMLElement {
  const m = c.merge;
  const subParts: (string | Node)[] = [];
  const tag = typeTag(c);
  if (tag) subParts.push(tag);
  if (m?.fromBase && (m.children.length || m.more)) subParts.push(ja.gitDetail.baseCommits(m.name ?? current?.base ?? '', mergeCountLabel(m)));
  subParts.push(c.short, formatAgo(c.at));
  const el = row(isHead ? 'head' : 'commit', [span('ctext', commitText(c))], subParts, link);
  // トグルは 2 行にまたがる高さで行の右端に置く（2 行目の中の小さな印では、押せることが分かりにくかった）
  if (m && !m.fromBase && m.children.length) el.append(mergeToggle(c, m, parts));
  el.toggleAttribute('data-merge', !!m);
  el.toggleAttribute('data-faded', faded || !!m?.fromBase);
  makeCopyable(el, c, isHead, el.querySelector<HTMLElement>('.sub')!, parts);
  return el;
}

/**
 * マージの子（取り込んだコミット）の行。1 段下げた小さい点と細い 2 本目の線で並べ、種別の札と件名だけを 1 行で出す。
 * 本線は行を貫いて次の行へつなぐ。last は子の最後（more なら、範囲の外へ続くので線を点線で伸ばす）
 */
function childRow(c: GitCommit, main: { in?: Link; out?: Link }, last: boolean, more: boolean, faded: boolean, parts: Parts): HTMLElement {
  const el = document.createElement('div');
  el.className = 'node linked git-node git-child';
  el.dataset.dot = 'commit';
  if (main.in) el.append(line('in', main.in));
  if (main.out) el.append(line('out', main.out));
  el.append(span('ln2 in'));
  if (!last || more) el.append(span(`ln2 out${last ? ' dashed' : ''}`));
  el.append(span('dot'));
  const t = document.createElement('div');
  t.className = 'title';
  const tag = typeTag(c);
  const text = span('ctext', commitText(c));
  t.append(...(tag ? [tag] : []), text);
  el.append(t);
  el.toggleAttribute('data-faded', faded);
  makeCopyable(el, c, false, text, parts);
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

/** 下の段。乗せた行のコミットの ID と日時、本文。乗せていなければ全体の件数 */
function showFoot(foot: HTMLElement, c: GitCommit | undefined) {
  if (c && c === footCommit) return;
  footCommit = c;
  const d = current;
  const b = document.createElement('b');
  if (!c) {
    const hint = span('hint', d?.failed || !d ? '' : ja.gitDetail.hint);
    if (!d) b.textContent = ja.gitDetail.loading;
    else if (d.failed) b.textContent = ja.gitDetail.failed;
    else if (d.mode === 'main') b.textContent = d.tracking ? ja.gitDetail.totalUnpushed(d.total) : ja.gitDetail.totalRecent(d.commits.length);
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
  // マージは、何をいくつ取り込んだか（分岐元なら、このブランチの作業に数えないこと）を本文の前に出す
  const m = c.merge;
  if (m) {
    const what = m.fromBase ? ja.gitDetail.baseNotCounted : m.name ? ja.gitDetail.mergeSummary(m.name, mergeCountLabel(m)) : '';
    if (what) text.append(span('merge-what', what));
  }
  if (c.body) text.append(document.createTextNode(c.body));
  else if (!text.childNodes.length) text.append(span('hint', ja.gitDetail.noBody));
  foot.replaceChildren(b, text);
}

function renderBody(parts: Parts) {
  const d = current;
  if (!d || d.failed) return parts.body.replaceChildren();
  const nodes: HTMLElement[] = [];
  // 上から順に並べる行。線は前の行とつなぐ
  type Item =
    | { kind: 'wip' }
    | { kind: 'commit'; c: GitCommit; head: boolean }
    | { kind: 'child'; c: GitCommit; last: boolean; more: boolean; faded: boolean }
    | { kind: 'fold'; n: number }
    | { kind: 'beyond'; n: number }
    | { kind: 'merge' }
    | { kind: 'base' };
  const items: Item[] = [];
  if (d.merged) items.push({ kind: 'merge' });
  if (d.changed || d.untracked) items.push({ kind: 'wip' });
  // 並べるのは本線だけ。マージの子は、トグルで開いたものだけをマージのすぐ下に出す
  const all = d.commits;
  const pushCommit = (c: GitCommit, head: boolean) => {
    items.push({ kind: 'commit', c, head });
    const m = c.merge;
    if (!m || m.fromBase || !openMerges.has(c.short)) return;
    m.children.forEach((k, i) => items.push({ kind: 'child', c: k, last: i === m.children.length - 1, more: !!m.more, faded: d.merged }));
  };
  // 件数は、本線のコミットとマージの子を合わせて数える（分岐元を取り込んだものは数えない。total と同じ数え方）
  const weight = (c: GitCommit) => (c.merge?.fromBase ? 0 : 1 + (c.merge?.children.length ?? 0));
  const counted = all.reduce((n, c) => n + weight(c), 0);
  const truncated = d.mode === 'worktree' || d.tracking ? d.total > counted : false;
  if (all.length > FOLD_OVER && !expanded) {
    pushCommit(all[0]!, true);
    pushCommit(all[1]!, false);
    // たたんだ行の数は、隠した行の数（分岐元を取り込んだマージも 1 行）と、その子の数
    const hidden = (list: GitCommit[]) => list.reduce((n, c) => n + Math.max(1, weight(c)), 0);
    if (truncated) items.push({ kind: 'fold', n: d.total - weight(all[0]!) - weight(all[1]!) });
    else {
      items.push({ kind: 'fold', n: hidden(all.slice(2, -1)) });
      pushCommit(all.at(-1)!, false);
    }
  } else {
    all.forEach((c, i) => pushCommit(c, i === 0));
    if (truncated) items.push({ kind: 'beyond', n: d.total - counted });
  }
  // 一番下の ◇：ワークツリーは分岐元、メインのカードは push していないコミットがあるときの追跡するブランチ
  if (d.mode === 'worktree' || d.tracking) items.push({ kind: 'base' });
  /** i 番目と次の行をつなぐ線。コミットしていない変更、たたんだ行、マージした先の前後は点線 */
  // マージの子の行は本線の外にあるので飛ばし、本線は子の行を貫いて次の行へつなぐ
  const linkAfter = (i: number): Link | undefined => {
    const a = items[i];
    let j = i + 1;
    while (items[j]?.kind === 'child') j++;
    const b = items[j];
    if (!a || !b) return undefined;
    const loose = (k: Item['kind']) => k === 'fold' || k === 'beyond';
    return a.kind === 'wip' || a.kind === 'merge' || loose(a.kind) || loose(b.kind) ? 'dashed' : 'solid';
  };
  let prevMain = -1;
  items.forEach((it, i) => {
    let link: { in?: Link; out?: Link };
    if (it.kind === 'child') {
      const through = prevMain >= 0 ? linkAfter(prevMain) : undefined;
      link = through ? { in: through, out: through } : {};
    } else {
      const out = linkAfter(i);
      const into = prevMain >= 0 ? linkAfter(prevMain) : undefined;
      link = { ...(into && { in: into }), ...(out && { out }) };
      prevMain = i;
    }
    if (it.kind === 'wip') {
      const el = row('wip', [document.createTextNode(ja.gitDetail.uncommitted)], [ja.gitDetail.uncommittedParts(d.changed, d.untracked)], link);
      el.addEventListener('pointermove', (e) => {
        if (e.movementX || e.movementY) showFoot(parts.foot, undefined);
      });
      nodes.push(el);
    } else if (it.kind === 'commit') nodes.push(commitRow(it.c, it.head && !d.merged, d.merged, link, parts));
    else if (it.kind === 'child') nodes.push(childRow(it.c, link, it.last, it.more, it.faded, parts));
    else if (it.kind === 'fold') nodes.push(foldRow(it.n, parts));
    else if (it.kind === 'beyond') nodes.push(row('none', [document.createTextNode(ja.gitDetail.beyondLimit(it.n, LOG_LIMIT))], [], link));
    else if (it.kind === 'merge') {
      // 図の端の印なので、題名は控えめにして、どこへ入ったかを 2 行目に出す
      nodes.push(row('base', [document.createTextNode(ja.gitDetail.mergedHere)], [d.mergedInto ?? d.base ?? ''], link));
    } else if (d.mode === 'main') {
      nodes.push(row('base', [document.createTextNode(ja.gitDetail.pushedHere)], [d.tracking ?? '', d.fork ?? ''], link));
    } else {
      const sub = [d.base ?? '', d.fork ?? '', d.baseAhead && !d.merged ? ja.gitDetail.baseAhead(d.baseAhead) : ''];
      nodes.push(row('base', [document.createTextNode(ja.gitDetail.forkHere)], sub, link));
    }
  });
  parts.body.replaceChildren(...nodes);
}

/** git の詳細を描く。detail がなければ読み込み中。fresh は新しく開いたとき（たたみ直す） */
export function renderGit(detail: GitDetail | undefined, parts: Parts, fresh: boolean) {
  if (fresh) {
    expanded = false;
    openMerges.clear();
  }
  current = detail;
  footCommit = undefined;
  parts.head.hidden = !detail;
  renderHead(parts.head, detail);
  // 下の段はコミットの数によらずいつも出す（本文の出る場所を変えない）。高さも変えない
  parts.foot.hidden = false;
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
