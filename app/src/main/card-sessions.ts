// カードの右クリックメニューで ID をコピーするセッションを探す（画面から受け取った ID は使わない）。

import { cardKeyOf } from '../shared/card-key';
import type { SessionView } from '../shared/types';

/** カードの目印が同じで、`local_` の ID を持つセッション。新しく動いた順 */
export function cardSessions(sessions: readonly SessionView[], key: string): SessionView[] {
  return sessions.filter((s) => s.id.startsWith('local_') && cardKeyOf(s) === key).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/** メニューの項目名に使う。Windows では & がアクセスキーの印になるので、そのまま出るように重ねる */
export function menuLabel(text: string): string {
  return text.replace(/&/g, '&&');
}
