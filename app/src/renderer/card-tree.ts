// カードを分岐元の下にぶら下げる並び（docs/design/worktree-cards.md の「ブランチのツリー」）。DOM に触らない計算だけ。

/** 字下げの深さの上限。ウィジェットは幅が狭いので、これより深いものは同じ深さに並べ、親の名前を添える */
export const TREE_MAX_DEPTH = 2;

/** ツリーを作るのに使うカードの項目 */
export interface TreeCard {
  key: string;
  isMain: boolean;
  label: string;
  /** カードのブランチ。ブランチにいない元のフォルダは undefined */
  branch?: string;
  /** 分岐元 */
  base?: string;
}

/** ツリーの 1 段 */
export interface TreeRow {
  /** card はカード、group はカードのない分岐元の見出し */
  kind: 'card' | 'group';
  /** カードの目印。group は `group:<分岐元>` */
  key: string;
  label: string;
  depth: number;
  /** 親より上の段の縦線を通すか（深さ 1 の段から順に。長さは depth - 1） */
  rails: boolean[];
  /** 同じ親の中で最後 */
  last: boolean;
  /** 下に子がぶら下がっている */
  hasChildren: boolean;
  /** 深さの上限で親の下に字下げできなかったときの、本当の親の名前 */
  via?: string;
}

interface Node {
  kind: 'card' | 'group';
  key: string;
  label: string;
  isMain: boolean;
  parent?: Node;
  children: Node[];
}

interface Entry {
  node: Node;
  via?: string;
  kids: Entry[];
}

/**
 * カードを親子の順に並べる。親は、カードの分岐元と同じブランチのカード。
 * 分岐元のカードがないときは見出しの段を作り、元のフォルダのカードの下（なければ一番上の段）に置く。
 * 元のフォルダのカードはいつも先頭。兄弟の順は渡された順のまま。分岐元が互いを指す（選び方によって起きる）ときは、一番上の段に置く。
 * hidden はアーカイブしたカードで、見出しの名前を短くするのに使う
 */
export function layoutCardTree(cards: TreeCard[], hidden: TreeCard[] = []): TreeRow[] {
  const nodes = new Map<TreeCard, Node>(cards.map((c) => [c, { kind: 'card', key: c.key, label: c.label, isMain: c.isMain, children: [] }]));
  const byBranch = new Map<string, Node>();
  // 同じブランチが 2 枚あれば、元のフォルダのカードを親にする
  for (const c of [...cards].sort((a, b) => Number(b.isMain) - Number(a.isMain))) {
    if (c.branch && !byBranch.has(c.branch)) byBranch.set(c.branch, nodes.get(c)!);
  }
  const mainNode = cards.find((c) => c.isMain);
  const root = mainNode ? nodes.get(mainNode) : undefined;
  const groups = new Map<string, Node>();
  const groupOf = (base: string) => {
    let g = groups.get(base);
    if (!g) {
      g = { kind: 'group', key: `group:${base}`, label: hidden.find((c) => c.branch === base)?.label ?? base, isMain: false, children: [], ...(root && { parent: root }) };
      groups.set(base, g);
    }
    return g;
  };
  for (const c of cards) {
    if (c.isMain || !c.base || c.base === c.branch) continue;
    const n = nodes.get(c)!;
    n.parent = byBranch.get(c.base) ?? groupOf(c.base);
  }
  for (const n of nodes.values()) {
    const seen = new Set<Node>([n]);
    for (let p = n.parent; p; p = p.parent) {
      if (seen.has(p)) {
        delete n.parent;
        break;
      }
      seen.add(p);
    }
  }

  const roots: Node[] = [];
  const attach = (n: Node) => {
    const list = n.parent ? n.parent.children : roots;
    if (!list.includes(n)) list.push(n);
  };
  for (const c of cards) {
    const n = nodes.get(c)!;
    if (n.parent?.kind === 'group') attach(n.parent);
    attach(n);
  }
  roots.sort((a, b) => Number(b.isMain) - Number(a.isMain));

  const entries = (list: Node[], depth: number, via?: string): Entry[] =>
    list.flatMap((node) => {
      const own = { node, ...(via && { via }) };
      if (depth < TREE_MAX_DEPTH) return [{ ...own, kids: entries(node.children, depth + 1) }];
      return [{ ...own, kids: [] }, ...entries(node.children, depth, node.label)];
    });

  const rows: TreeRow[] = [];
  const walk = (list: Entry[], depth: number, rails: boolean[]) => {
    list.forEach((e, i) => {
      const last = i === list.length - 1;
      rows.push({
        kind: e.node.kind,
        key: e.node.key,
        label: e.node.label,
        depth,
        rails,
        last,
        hasChildren: e.kids.length > 0,
        ...(e.via && { via: e.via }),
      });
      walk(e.kids, depth + 1, depth > 0 ? [...rails, !last] : []);
    });
  };
  walk(entries(roots, 0), 0, []);
  return rows;
}
