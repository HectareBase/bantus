// メインプロセスと画面の両方で使う型

/** 表示上の状態。並び順もこの順（docs/session-status.md） */
export type SessionState = 'waiting' | 'busy' | 'idle' | 'stopped';

export interface SessionView {
  /** `local_` から始まる ID。claude:// リンクに使う */
  id: string;
  title: string;
  /** カードの目印。リポジトリのフォルダ（git の情報がなければ元の作業フォルダ）を小文字にしたもの */
  repoKey: string;
  /** カードの名前（リポジトリのフォルダ名） */
  repoName: string;
  /** メインの作業場所のブランチ名（`.git/HEAD` から。わからなければ undefined） */
  mainBranch?: string;
  /** ワークツリーのときだけ。小見出しの目印と表示名 */
  worktree?: {
    key: string;
    /** 短くした表示名（`claude/` と末尾の英数字を省く） */
    label: string;
    /** 元のブランチ名（ツールチップ用） */
    branch: string;
  };
  state: SessionState;
  /** state が waiting のときの理由（`permission prompt` など） */
  waitingFor?: string;
  /** 最後のターンのまとめで「対応が必要」とされた内容 */
  needsAction?: string;
  /** 最後のターンのまとめ（ツールチップ用） */
  detail?: string;
  /** 最後に動きがあった時刻（Unix ミリ秒） */
  lastActivityAt: number;
}

export interface WidgetApi {
  onSessions(listener: (sessions: SessionView[]) => void): void;
  openSession(id: string): void;
  setCollapsed(collapsed: boolean): void;
  quit(): void;
}

declare global {
  interface Window {
    widget: WidgetApi;
  }
}
