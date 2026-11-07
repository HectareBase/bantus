// main にマージされたあとの切り替え方（src/main/update-plan.ts）
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileAction, updatePlan } from '../src/main/update-plan';

describe('fileAction', () => {
  it('app/ の外、テスト、見本データ、文書、文言の検査の設定は何もしない', () => {
    for (const f of ['docs/README.md', 'tools/watch-status.ps1', 'package.json', 'app/test/model.test.ts', 'app/fixtures/empty.json', 'app/README.md', 'app/scripts/debug.mjs', 'app/electron-builder.yml', 'app/text/terms.yml', 'app/.textlintrc', 'app/scripts/lint-ja.mjs']) {
      assert.equal(fileAction(f), 'none', f);
    }
  });

  it('画面のソースと静的ファイルのコピーは再読み込み', () => {
    for (const f of ['app/src/renderer/model.ts', 'app/src/renderer/index.html', 'app/src/renderer/widget.css', 'app/scripts/copy-static.mjs']) {
      assert.equal(fileAction(f), 'reload', f);
    }
  });

  it('メインプロセス、preload、共通の型、設定ファイル、アイコンは起動し直し', () => {
    for (const f of ['app/src/main/main.ts', 'app/src/preload/preload.ts', 'app/src/shared/settings.ts', 'app/package.json', 'app/tsconfig.main.json', 'app/assets/icon.ico']) {
      assert.equal(fileAction(f), 'relaunch', f);
    }
  });

  it('package-lock.json は入れ直しが必要', () => {
    assert.equal(fileAction('app/package-lock.json'), 'reinstall');
  });

  it('区切りが \\ でも同じ', () => {
    assert.equal(fileAction('app\\src\\main\\main.ts'), 'relaunch');
  });
});

describe('updatePlan', () => {
  it('いちばん重いものを選ぶ', () => {
    assert.equal(updatePlan([]), 'none');
    assert.equal(updatePlan(['docs/a.md', 'app/src/renderer/model.ts']), 'reload');
    assert.equal(updatePlan(['app/src/renderer/model.ts', 'app/src/main/main.ts', 'docs/a.md']), 'relaunch');
    assert.equal(updatePlan(['app/src/main/main.ts', 'app/package-lock.json']), 'reinstall');
  });
});
