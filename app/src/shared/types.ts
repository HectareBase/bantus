// メインプロセスと画面の両方で使う型

/** 表示上の状態。並び順もこの順（docs/session-status.md） */
export type SessionState = 'waiting' | 'busy' | 'idle' | 'stopped';

export interface SessionView {
  /** `local_` から始まる ID。claude:// リンクに使う */
  id: string;
  title: string;
  /** 作業フォルダの末尾の名前 */
  folder: string;
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
