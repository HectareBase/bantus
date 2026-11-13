// 設定ファイルを消さないための判定（src/main/settings-file.ts）
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LAST_VERSION_KEY, backupFileName, backupVersion, backupsToRemove, isSettingsObject, mergeForSave } from '../src/main/settings-file';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings';

describe('読んだ JSON の形', () => {
  it('オブジェクトだけを設定として使う', () => {
    assert.equal(isSettingsObject({}), true);
    assert.equal(isSettingsObject(null), false);
    assert.equal(isSettingsObject([]), false);
    assert.equal(isSettingsObject(3), false);
    assert.equal(isSettingsObject('x'), false);
  });
});

describe('保存する中身の重ね合わせ', () => {
  const save = (raw: Record<string, unknown>, patch: Record<string, unknown> = {}) => {
    const loaded = normalizeSettings(raw);
    const current = normalizeSettings({ ...loaded, ...patch });
    return mergeForSave(raw, loaded, current, '1.0.0');
  };

  it('知らない項目は残す', () => {
    const out = save({ futureOption: { a: 1 }, pinned: true }, { pinned: false });
    assert.deepEqual(out.futureOption, { a: 1 });
    assert.equal(out.pinned, false);
  });
  it('今の版の項目は今の値で書く', () => {
    const out = save({}, { width: 400 });
    assert.equal(out.width, 400);
    assert.equal(out.edge, DEFAULT_SETTINGS.edge);
  });
  it('知らない値は、ユーザーが変えていなければ生の値を残す', () => {
    const out = save({ theme: 'sepia', edge: 'top' }, { width: 400 });
    assert.equal(out.theme, 'sepia');
    assert.equal(out.edge, 'top');
  });
  it('知らない値でも、ユーザーが変えたら今の値で書く', () => {
    const out = save({ theme: 'sepia' }, { theme: 'dark' });
    assert.equal(out.theme, 'dark');
  });
  it('範囲の外の数も、変えていなければ生の値を残す', () => {
    assert.equal(save({ width: 99999 }).width, 99999);
  });
  it('前の版の強調の濃さは、今の版の値（%）で上書きする', () => {
    assert.equal(save({ activeHighlight: 'strong' }).activeHighlight, 100);
  });
  it('前の版の項目（alwaysShow）は捨てる', () => {
    assert.equal('alwaysShow' in save({ alwaysShow: [] }), false);
  });
  it('保存した版を書く', () => {
    assert.equal(save({ [LAST_VERSION_KEY]: '0.1.0' })[LAST_VERSION_KEY], '1.0.0');
  });
});

describe('版のバックアップ', () => {
  it('前回と同じ版なら作らない', () => assert.equal(backupVersion({ lastVersion: '1.0.0' }, '1.0.0'), undefined));
  it('上げたときも戻したときも、前の版の名前で作る', () => {
    assert.equal(backupVersion({ lastVersion: '0.9.0' }, '1.0.0'), '0.9.0');
    assert.equal(backupVersion({ lastVersion: '1.1.0' }, '1.0.0'), '1.1.0');
  });
  it('前の版が書かれていなければ unknown', () => {
    assert.equal(backupVersion({}, '1.0.0'), 'unknown');
    assert.equal(backupVersion({ lastVersion: 5 }, '1.0.0'), 'unknown');
  });
  it('ファイル名', () => {
    assert.equal(backupFileName('0.8.0'), 'settings.0.8.0.bak');
    assert.equal(backupFileName('1.0.0-beta+1'), 'settings.1.0.0-beta_1.bak');
    assert.equal(backupFileName('../x'), 'settings..._x.bak');
  });
  it('新しいほうから 3 個を残し、ほかのファイルには触れない', () => {
    const files = [
      { name: 'settings.json', mtimeMs: 1 },
      { name: 'settings.json.bad', mtimeMs: 2 },
      { name: 'settings.0.1.0.bak', mtimeMs: 10 },
      { name: 'settings.0.2.0.bak', mtimeMs: 40 },
      { name: 'settings.unknown.bak', mtimeMs: 20 },
      { name: 'settings.0.3.0.bak', mtimeMs: 30 },
      { name: 'settings.0.4.0.bak', mtimeMs: 50 },
    ];
    assert.deepEqual(backupsToRemove(files).sort(), ['settings.0.1.0.bak', 'settings.unknown.bak']);
  });
  it('3 個以下なら消さない', () => assert.deepEqual(backupsToRemove([{ name: 'settings.0.1.0.bak', mtimeMs: 1 }]), []));
});
