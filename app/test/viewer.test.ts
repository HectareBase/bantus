// HTML ビューア（docs/design/html-viewer.md）：パスの検査、出すものの決め方、設定

import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { cardKeyOf } from '../src/shared/card-key';
import { readFixture } from '../src/main/sessions';
import { liveViewerKeys, resolveViewerTarget, type ViewerFs } from '../src/main/viewer-target';
import { CATEGORIES, DEFAULT_SETTINGS, SETTING_DEFS, VIEWER_HEIGHT_MIN, clampViewerHeight, normalizeSettings } from '../src/shared/settings';
import { ja } from '../src/shared/strings/ja';
import { checkViewerPath, isInside, isViewerPath, viewerFileName } from '../src/shared/viewer-path';
import { FIXTURES, tempDir, view } from './helpers';

describe('checkViewerPath', () => {
  it('相対パスを / にそろえて受け付ける', () => {
    assert.deepEqual(checkViewerPath('docs\\report.html'), { path: 'docs/report.html' });
    assert.deepEqual(checkViewerPath('  ./docs//a/../index.HTM '), { path: 'docs/index.HTM' });
  });
  it('空は「まだ決めていない」', () => assert.deepEqual(checkViewerPath('  '), { path: '' }));
  it('絶対パスとドライブ名は受け付けない', () => {
    for (const p of ['/etc/a.html', '\\\\server\\share\\a.html', 'C:\\a.html', 'c:a.html', '~/a.html']) {
      assert.deepEqual(checkViewerPath(p), { problem: 'absolute' }, p);
    }
  });
  it('.. でルートの外に出るものは受け付けない', () => {
    assert.deepEqual(checkViewerPath('../a.html'), { problem: 'outside' });
    assert.deepEqual(checkViewerPath('docs/../../a.html'), { problem: 'outside' });
  });
  it('.html と .htm のほかは受け付けない', () => {
    for (const p of ['a.txt', 'a.html.exe', 'docs', 'a.svg']) assert.deepEqual(checkViewerPath(p), { problem: 'extension' }, p);
  });
  it('使えない文字や形は受け付けない', () => {
    for (const p of ['a?.html', 'a.html:stream', 'docs./a.html', 'a\n.html', '.', 'a/..']) assert.deepEqual(checkViewerPath(p), { problem: 'invalid' }, p);
  });
  it('isViewerPath はそろえた形だけを通す', () => {
    assert.equal(isViewerPath('docs/a.html'), true);
    assert.equal(isViewerPath(''), true);
    assert.equal(isViewerPath('docs\\a.html'), false);
    assert.equal(isViewerPath(1), false);
  });
  it('ファイル名', () => assert.equal(viewerFileName('docs/a.html'), 'a.html'));
});

describe('isInside', () => {
  it('ルートの下だけを中とする（大文字と小文字、区切りの違いは問わない）', () => {
    assert.equal(isInside('C:\\Repo', 'c:/repo/docs/a.html'), true);
    assert.equal(isInside('C:\\Repo\\', 'C:\\Repo\\a.html'), true);
    assert.equal(isInside('C:\\Repo', 'C:\\Repo'), false);
    assert.equal(isInside('C:\\Repo', 'C:\\Repo2\\a.html'), false);
  });
});

/** 一時フォルダにファイルを作って、本物の fs で確かめる */
const realFs: ViewerFs = {
  realFile: (p) => {
    try {
      return statSync(p).isFile() ? realpathSync.native(p) : undefined;
    } catch {
      return undefined;
    }
  },
  realDir: (p) => {
    try {
      return statSync(p).isDirectory() ? realpathSync.native(p) : undefined;
    } catch {
      return undefined;
    }
  },
};

describe('resolveViewerTarget', () => {
  it('開いているセッションがなければ noSession、パスがなければ noPath', () => {
    assert.deepEqual(resolveViewerTarget(undefined, 'a.html', undefined, realFs).state, { kind: 'noSession' });
    assert.deepEqual(resolveViewerTarget(view({ workDir: 'C:\\x' }), '', undefined, realFs).state, { kind: 'noPath' });
  });
  it('作業フォルダがなければ noDir（ファイル名とワークツリー名は出す）', () => {
    const s = view({ worktree: { key: 'wt', label: 'fix-login', branch: 'claude/fix-login' } });
    assert.deepEqual(resolveViewerTarget(s, 'docs/a.html', undefined, realFs).state, { kind: 'noDir', file: 'a.html', place: 'fix-login' });
  });
  it('元のフォルダならブランチ名、わからなければ「元のフォルダ」', () => {
    assert.equal((resolveViewerTarget(view({ mainBranch: 'main' }), 'a.html', undefined, realFs).state as { place: string }).place, 'main');
    assert.equal((resolveViewerTarget(view(), 'a.html', undefined, realFs).state as { place: string }).place, ja.widget.originFolder);
  });
  it('ファイルがあれば ok。目印は作業フォルダを小文字にしたもの', () => {
    const tmp = tempDir();
    try {
      mkdirSync(join(tmp.path, 'Docs'));
      writeFileSync(join(tmp.path, 'Docs', 'a.html'), '<p>a</p>');
      const t = resolveViewerTarget(view({ workDir: tmp.path }), 'Docs/a.html', undefined, realFs);
      assert.equal(t.state.kind, 'ok');
      assert.equal(t.key, tmp.path.toLowerCase());
      assert.equal(t.file, realpathSync.native(join(tmp.path, 'Docs', 'a.html')));
    } finally {
      tmp.cleanup();
    }
  });
  it('ファイルがなければ missing と探した場所。元のフォルダの同じファイルに代えない', () => {
    const tmp = tempDir();
    try {
      writeFileSync(join(tmp.path, 'a.html'), '<p>main</p>');
      mkdirSync(join(tmp.path, 'wt'));
      const s = view({ workDir: join(tmp.path, 'wt'), worktree: { key: 'wt', label: 'wt', branch: 'wt' } });
      assert.deepEqual(resolveViewerTarget(s, 'a.html', undefined, realFs).state, { kind: 'missing', file: 'a.html', place: 'wt', path: join(tmp.path, 'wt', 'a.html') });
    } finally {
      tmp.cleanup();
    }
  });
  it('フォルダの名前が .html でも、ファイルでなければ missing', () => {
    const tmp = tempDir();
    try {
      mkdirSync(join(tmp.path, 'a.html'));
      assert.equal(resolveViewerTarget(view({ workDir: tmp.path }), 'a.html', undefined, realFs).state.kind, 'missing');
    } finally {
      tmp.cleanup();
    }
  });
  it('realpath をとった先が作業フォルダの外なら missing', () => {
    const fs: ViewerFs = { realDir: () => 'C:\\repo', realFile: () => 'C:\\elsewhere\\a.html' };
    assert.equal(resolveViewerTarget(view({ workDir: 'C:\\repo' }), 'a.html', undefined, fs).state.kind, 'missing');
  });
  it('保存されたパスがおかしければ noPath（画面からの値をそのまま使わない）', () => {
    const fs: ViewerFs = { realDir: (p) => p, realFile: (p) => p };
    assert.equal(resolveViewerTarget(view({ workDir: 'C:\\repo' }), '../a.html', undefined, fs).state.kind, 'noPath');
  });
  it('カードをアーカイブしていれば archived', () => {
    const fs: ViewerFs = { realDir: (p) => p, realFile: (p) => p };
    const s = view({ workDir: 'C:\\repo' });
    assert.equal(resolveViewerTarget(s, 'a.html', new Set(), fs).state.kind, 'archived');
    assert.equal(resolveViewerTarget(s, 'a.html', new Set([cardKeyOf(s)]), fs).state.kind, 'ok');
  });
});

describe('liveViewerKeys', () => {
  it('作業フォルダがあり、カードを出しているものだけ', () => {
    const a = view({ workDir: 'C:\\A', repoKey: 'r', worktree: { key: 'a', label: 'a', branch: 'a' } });
    const b = view({ workDir: 'C:\\B', repoKey: 'r', worktree: { key: 'b', label: 'b', branch: 'b' } });
    const c = view({ repoKey: 'r' });
    assert.deepEqual([...liveViewerKeys([a, b, c], undefined)].sort(), ['c:\\a', 'c:\\b']);
    assert.deepEqual([...liveViewerKeys([a, b, c], new Set([cardKeyOf(a)]))], ['c:\\a']);
  });
});

describe('ビューアの設定', () => {
  it('既定は出さない・パスなし・変更を反映する・高さ 240・畳まない', () => {
    const s = normalizeSettings({});
    assert.deepEqual([s.viewerEnabled, s.viewerPath, s.viewerAutoReload, s.viewerHeight, s.viewerCollapsed], [false, '', true, 240, false]);
  });
  it('カテゴリは panel-bottom のアイコン', () => assert.equal(CATEGORIES.find((c) => c.id === 'viewer')?.icon, 'panel-bottom'));
  it('パスと自動の読み込み直しは、出さないとき押せない', () =>
    assert.deepEqual(SETTING_DEFS.filter((d) => d.enabledBy === 'viewerEnabled').map((d) => d.key), ['viewerPath', 'viewerAutoReload']));
  it('パスは検査を通ったものだけを、そろえて保存する', () => {
    assert.equal(normalizeSettings({ viewerPath: 'docs\\a.html' }).viewerPath, 'docs/a.html');
    assert.equal(normalizeSettings({ viewerPath: 'C:\\a.html' }).viewerPath, DEFAULT_SETTINGS.viewerPath);
    assert.equal(normalizeSettings({ viewerPath: 3 }).viewerPath, DEFAULT_SETTINGS.viewerPath);
  });
  it('パスの検査は理由の文言を返す', () => {
    const def = SETTING_DEFS.find((d) => d.key === 'viewerPath');
    assert.ok(def && def.type === 'text');
    assert.deepEqual(def.check('../a.html'), { error: ja.settings.viewerPathProblems.outside });
    assert.deepEqual(def.check('a.htm'), { value: 'a.htm' });
  });
  it('高さと畳んだ状態は、設定画面に出さないが保存する', () => {
    assert.equal(normalizeSettings({ viewerHeight: 333.4 }).viewerHeight, 333);
    assert.equal(normalizeSettings({ viewerHeight: 10 }).viewerHeight, VIEWER_HEIGHT_MIN);
    assert.equal(normalizeSettings({ viewerHeight: 'x' }).viewerHeight, 240);
    assert.equal(normalizeSettings({ viewerCollapsed: true }).viewerCollapsed, true);
  });
  it('高さは 80px から「ウィンドウの高さ − 160px」まで。ウィンドウが低ければ下限', () => {
    assert.equal(clampViewerHeight(900, 1000), 840);
    assert.equal(clampViewerHeight(300.6, 1000), 301);
    assert.equal(clampViewerHeight(20, 1000), 80);
    assert.equal(clampViewerHeight(300, 200), 80);
  });
});

describe('見本データの作業フォルダ', () => {
  it('見本データのファイルから見た相対パスで書ける', () => {
    const list = readFixture(join(FIXTURES, 'all-states.json'), Date.now(), 0);
    const s = list.find((x) => x.id === 'local_all-03');
    assert.equal(s?.workDir, join(FIXTURES, 'viewer', 'my-app'));
  });
});
