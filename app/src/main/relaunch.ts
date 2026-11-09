// 起動し直すときの引数。設定を変えて起動し直したときは、設定ウィンドウを開き直す。

/** 起動し直したあとに設定ウィンドウを開く印（コマンドラインの引数） */
export const OPEN_SETTINGS_ARG = '--bantus-open-settings';

/**
 * app.relaunch に渡す引数。npm start（electron .）では、どのフォルダのアプリかを先頭に付ける。
 * インストール版では付けない（exe はアプリを自分で持っている）
 */
export function relaunchArgs(packaged: boolean, appPath: string, openSettings: boolean): string[] {
  return [...(packaged ? [] : [appPath]), ...(openSettings ? [OPEN_SETTINGS_ARG] : [])];
}
