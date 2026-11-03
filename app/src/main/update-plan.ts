// main にマージされたあと、いつものウィジェットをどう新しいコードに切り替えるかの判定。
// 変わったファイル（git diff --name-only の出力。リポジトリの一番上からのパス）だけで決める純粋な関数（test/update-plan.test.ts）。

/**
 * - none：何もしない（app/ の外、テスト、見本データ、文書だけの変更）
 * - reload：ビルドしてウィンドウを読み込み直す（画面だけの変更）
 * - relaunch：ビルドして起動し直す（メインプロセス、preload、共通の型、設定ファイルなど）
 * - reinstall：依存が変わった。自動では入れ直さず、npm run setup が必要と知らせるだけ
 */
export type UpdateAction = 'none' | 'reload' | 'relaunch' | 'reinstall';

/** 変えても、動いているウィジェットに関係しないもの */
const IGNORED = [/^app\/test\//, /^app\/fixtures\//, /^app\/scripts\/(?!copy-static\.mjs$)/, /^app\/electron-builder\.yml$/, /\.md$/i];
/** ビルドして読み込み直せば済むもの（画面のソースと、dist/web/ にコピーする静的ファイル） */
const RELOAD = [/^app\/src\/renderer\//, /^app\/scripts\/copy-static\.mjs$/];

const RANK: Record<UpdateAction, number> = { none: 0, reload: 1, relaunch: 2, reinstall: 3 };

/** 1 つのファイルの変更で要るもの。分からない app/ のファイルは、安全な方（起動し直し）にする */
export function fileAction(path: string): UpdateAction {
  const p = path.replace(/\\/g, '/');
  if (!p.startsWith('app/')) return 'none';
  if (p === 'app/package-lock.json') return 'reinstall';
  if (IGNORED.some((r) => r.test(p))) return 'none';
  if (RELOAD.some((r) => r.test(p))) return 'reload';
  return 'relaunch';
}

/** 変わったファイル全体で要るもの。いちばん重いものを選ぶ */
export function updatePlan(files: readonly string[]): UpdateAction {
  let action: UpdateAction = 'none';
  for (const f of files) {
    const a = fileAction(f);
    if (RANK[a] > RANK[action]) action = a;
  }
  return action;
}
