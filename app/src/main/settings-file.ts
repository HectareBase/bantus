// 設定ファイル（settings.json）を消さないための判定。ファイルを読み書きする部分は settings-store.ts にあり、
// ここは純粋な関数だけにする（test/settings-file.test.ts）。

import { LEGACY_KEYS, isLegacyValue, type Settings } from '../shared/settings';

/** settings.json に足す、最後に保存した版の項目。今の版の設定（Settings）には入れない */
export const LAST_VERSION_KEY = 'lastVersion';

/** 版のバックアップ（settings.<版>.bak）を残す数 */
export const BACKUP_KEEP = 3;

/** 読んだ JSON が設定として使える形か。オブジェクトでなければ（null、配列、数など）壊れたファイルとして扱う */
export function isSettingsObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 保存する中身を作る。読んだときの生のオブジェクト（raw）に、今の版が知っている項目（current）を重ねる。
 * 知らない項目（新しい版で足された項目）は raw のまま残る。
 *
 * 今の版が知っている項目でも、値が不正で読んだときに置き換えた（loaded と raw が違う）もので、
 * その後ユーザーが変えていない（current と loaded が同じ）ものは、raw の値を残す。新しい版の選択肢かもしれないため。
 * ただし、前の版の値を変換した項目（isLegacyValue）は今の版の値で上書きし、前の版の項目（LEGACY_KEYS）は捨てる。
 * 最後に、保存した版（LAST_VERSION_KEY）を書く。
 */
export function mergeForSave(
  raw: Record<string, unknown>,
  loaded: Settings,
  current: Settings,
  version: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  for (const key of LEGACY_KEYS) delete out[key];
  for (const [key, value] of Object.entries(current)) {
    const keepRaw =
      key in raw &&
      !isLegacyValue(key, raw[key]) &&
      sameValue(value, (loaded as unknown as Record<string, unknown>)[key]) &&
      !sameValue(raw[key], value);
    if (!keepRaw) out[key] = value;
  }
  out[LAST_VERSION_KEY] = version;
  return out;
}

/**
 * 起動して読んだときに、版のバックアップを作るか。作るなら、ファイル名に入れる前の版を返す。
 * 前の版が書かれていない（この仕組みより前の版が書いたファイル）ときは 'unknown' にする
 */
export function backupVersion(raw: Record<string, unknown>, version: string): string | undefined {
  const last = raw[LAST_VERSION_KEY];
  if (typeof last !== 'string' || !last) return 'unknown';
  return last === version ? undefined : last;
}

/** 版のバックアップのファイル名。ファイル名に使えない文字は _ にする */
export function backupFileName(version: string): string {
  return `settings.${version.replace(/[^0-9A-Za-z._-]/g, '_')}.bak`;
}

const BACKUP_NAME = /^settings\..+\.bak$/;

/** フォルダの中のファイルのうち、消す版のバックアップの名前。新しい（更新日時が後の）ほうから keep 個を残す */
export function backupsToRemove(files: { name: string; mtimeMs: number }[], keep = BACKUP_KEEP): string[] {
  return files
    .filter((f) => BACKUP_NAME.test(f.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .slice(keep)
    .map((f) => f.name);
}
