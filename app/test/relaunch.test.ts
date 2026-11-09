// 起動し直すときの引数（src/main/relaunch.ts）

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OPEN_SETTINGS_ARG, relaunchArgs } from '../src/main/relaunch';

describe('relaunchArgs', () => {
  it('npm start では、アプリのフォルダを先頭に付ける', () => assert.deepEqual(relaunchArgs(false, 'C:\app', false), ['C:\app']));
  it('インストール版では、アプリのフォルダを付けない', () => assert.deepEqual(relaunchArgs(true, 'C:\app.asar', false), []));
  it('設定を変えて起動し直すときは、設定ウィンドウを開く印を付ける', () => {
    assert.deepEqual(relaunchArgs(false, 'C:\app', true), ['C:\app', OPEN_SETTINGS_ARG]);
    assert.deepEqual(relaunchArgs(true, 'C:\app.asar', true), [OPEN_SETTINGS_ARG]);
  });
});
