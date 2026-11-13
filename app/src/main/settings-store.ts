// 設定の読み書き。保存先は Electron のデータフォルダ（%APPDATA% の中）の settings.json で、リポジトリには入らない。
// 設定が消えないように、次のことをする（判定は settings-file.ts）。
// - 一時ファイル（settings.json.tmp）に書いてから置き換える。途中で止まっても元のファイルは壊れない
// - 読めなかったファイルは settings.json.bad に移してから既定値で動く
// - 知らない項目（新しい版の設定）は、読んだときの値のまま残して保存する
// - 前回と版が違えば、書き込む前に settings.<前の版>.bak にコピーする。新しいほうから 3 個だけを残す

import { app } from 'electron';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { normalizeSettings, type Settings } from '../shared/settings';
import { backupFileName, backupsToRemove, backupVersion, isSettingsObject, mergeForSave } from './settings-file';

const file = () => join(app.getPath('userData'), 'settings.json');

let current: Settings | undefined;
/** 読んだときの生のオブジェクト。保存のときに知らない項目を残すため */
let raw: Record<string, unknown> = {};
/** 読んだときにそろえた値。ユーザーが変えた項目かを見分けるため */
let loaded: Settings | undefined;
const listeners: ((s: Settings) => void)[] = [];

/** 読めなかったファイルを settings.json.bad に移す（前のものは上書き）。移せなければコピーを試す */
function keepBadFile(path: string) {
  const bad = `${path}.bad`;
  try {
    renameSync(path, bad);
  } catch {
    try {
      copyFileSync(path, bad);
    } catch {
      // 残せなくても、既定値で動く
    }
  }
}

/** 版のバックアップを作り、古いものを消す */
function backupForVersion(path: string, version: string) {
  const dir = dirname(path);
  try {
    const bak = join(dir, backupFileName(version));
    copyFileSync(path, bak);
    // Windows のコピーは元の更新日時を引き継ぐ。残す .bak を更新日時で選ぶので、作った時刻にする
    const now = new Date();
    utimesSync(bak, now, now);
    const files = readdirSync(dir).map((name) => {
      try {
        return { name, mtimeMs: statSync(join(dir, name)).mtimeMs };
      } catch {
        return { name, mtimeMs: 0 };
      }
    });
    for (const name of backupsToRemove(files)) rmSync(join(dir, name), { force: true });
  } catch {
    // バックアップに失敗しても、設定はいつもどおり読む
  }
}

function load(): Settings {
  const path = file();
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    // ファイルがない（はじめての起動）ときはそのまま既定値。ほかの理由で読めないときは残しておく
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') keepBadFile(path);
    return normalizeSettings({});
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!isSettingsObject(parsed)) {
    keepBadFile(path);
    return normalizeSettings({});
  }
  raw = parsed;
  const prev = backupVersion(raw, app.getVersion());
  if (prev !== undefined) backupForVersion(path, prev);
  return normalizeSettings(raw);
}

export function getSettings(): Settings {
  if (!current) {
    current = load();
    loaded = current;
  }
  return current;
}

/** 一時ファイルに書いてから置き換える。置き換えられなければ、じかに書く */
function writeSafely(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  try {
    renameSync(tmp, path);
  } catch {
    // ほかのプログラムが開いているなどで置き換えられないとき
    writeFileSync(path, text);
    rmSync(tmp, { force: true });
  }
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const base = getSettings();
  current = normalizeSettings({ ...base, ...patch });
  try {
    writeSafely(file(), JSON.stringify(mergeForSave(raw, loaded ?? base, current, app.getVersion()), null, 2));
  } catch {
    // 保存に失敗しても、今の起動中は新しい値で動く
  }
  for (const l of listeners) l(current);
  return current;
}

export function onSettingsChange(listener: (s: Settings) => void) {
  listeners.push(listener);
}

export function settingsFilePath(): string {
  return file();
}
