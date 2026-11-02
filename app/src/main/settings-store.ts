// 設定の読み書き。保存先は Electron のデータフォルダ（%APPDATA% の中）の settings.json で、リポジトリには入らない。

import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { normalizeSettings, type Settings } from '../shared/settings';

const file = () => join(app.getPath('userData'), 'settings.json');

let current: Settings | undefined;
const listeners: ((s: Settings) => void)[] = [];

export function getSettings(): Settings {
  if (!current) {
    try {
      current = normalizeSettings(JSON.parse(readFileSync(file(), 'utf8')));
    } catch {
      current = normalizeSettings({});
    }
  }
  return current;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = normalizeSettings({ ...getSettings(), ...patch });
  try {
    mkdirSync(dirname(file()), { recursive: true });
    writeFileSync(file(), JSON.stringify(current, null, 2));
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
