// 画面の文言（src/shared/strings/ja.ts）を textlint で 1 つずつ検査する。npm run lint:ja と npm test から動く。
//   規則は .textlintrc と自作の text/rules/、用語の辞書は text/terms.yml。
//   関数の文言は、下の SAMPLES の引数で呼んだ結果を検査する。関数を足したら SAMPLES にも足す（ないと失敗する）。
// ja.ts は Node の型の取り除きで直接読む（package.json に "type" がないという警告は止めて動かす）。
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TextlintKernelDescriptor } from '@textlint/kernel';
import { createLinter, loadTextlintrc } from 'textlint';
import noPlainPast from '../text/rules/no-plain-past.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { ja } = await import(pathToFileURL(join(root, 'src', 'shared', 'strings', 'ja.ts')).href);

/** 関数の文言を呼ぶ見本の引数。実際に入る値に近いものにする（数は 2 以上、名前は画面に出るもの） */
const SAMPLES = {
  'app.worktreeLabel': [['ja-strings']],
  'window.settings': [['Bantus']],
  'window.tip': [['Bantus']],
  'window.flyout': [['Bantus']],
  'monitor.other': [[2, 1920, 1080]],
  'state.waitingWithReason': [['許可待ち']],
  'settings.tooltipDelay.seconds': [[0.4]],
  'time.minutesAgo': [[5]],
  'time.hoursAgo': [[3]],
  'time.daysAgo': [[2]],
  'time.heldMinutes': [[5]],
  'time.busyMinutes': [[12]],
  'time.busyHours': [[1, 5], [2, 0]],
  'time.heldHours': [[3]],
  'time.heldDays': [[2]],
  'tooltip.worktree': [['feature-x']],
  'tooltip.origin': [['main']],
  'tooltip.waiting': [['許可待ち']],
  'tooltip.background': [[1], [3]],
  'tooltip.plan': [[2, 3], [8, 8]],
  'tooltip.needsAction': [['ファイルの書き込みの許可']],
  'tooltip.contextPercent': [[12, '24k', '200k']],
  'tooltip.contextUnknownWindow': [['24k', 'claude-x'], ['24k']],
  'changes.changed': [[2]],
  'gitDetail.behind': [['origin/main', 2]],
  'gitDetail.uncommittedParts': [[2, 1]],
  'gitDetail.more': [[12]],
  'gitDetail.beyondLimit': [[30, 50]],
  'gitDetail.baseAhead': [[4]],
  'gitDetail.totalAhead': [['main', 3]],
  'gitDetail.mergeOf': [['main']],
  'gitDetail.baseCommits': [['main', '3+']],
  'gitDetail.mergeSummary': [['claude/fix-login', '3']],
  'gitDetail.totalMerged': [[3]],
  'gitDetail.totalRecent': [[5]],
  'gitDetail.totalUnpushed': [[9]],
  'gitDetail.noCommits': [['main']],
  'changes.untracked': [[1]],
  'changes.uncommitted': [['変更 2・未追跡 1']],
  'changes.aheadOfBase': [[3]],
  'changes.unpushed': [[3]],
  'changes.behind': [[4]],
  'changes.behindNamed': [['origin/main', 3]],
  'changes.aheadOfNamedBase': [['develop', 3]],
  'settings.fetchStatus.last': [['3 分前']],
  'settings.fetchStatus.failed': [['claude-helper', '認証に失敗']],
  'toast.withRest': [['完了', 2]],
  'widget.archivedCount': [[3]],
  'widget.badgeWaiting': [[2]],
  'widget.badgeBusy': [[2]],
  'widget.badgeHeld': [[2]],
  'widget.cpuTip': [[12]],
  'switcher.minimized': [['メモ帳']],
  'switcher.front': [['メモ帳']],
  'switcher.behind': [['メモ帳']],
  'switcher.more': [[3]],
  'widget.memTip': [['9.3', '16', 58]],
  'flyout.continuedIn': [['feature-x']],
  'flyout.startedIn': [['C:/work/my-app']],
  'tooltip.base': [['develop']],
  'changes.mergedInto': [['main', 'develop'], ['main']],
  'flyout.baseRootMerged': [['main']],
  'flyout.mergedInto': [['main']],
  'widget.branchedFromTip': [['integration/new_feature', 'main']],
  'settings.options.minutes': [[10]],
  'settings.options.hours': [[1]],
  'settings.colors.customAria': [['処理中']],
  'settings.colors.choicesAria': [['処理中']],
  'settings.colors.currentAria': [['処理中', '#e8a33c']],
};

/** 検査する文言の一覧（キーと文字）。関数は見本の引数で呼ぶ */
function collect(node, path, out, missing) {
  if (typeof node === 'string') out.push({ key: path, text: node });
  else if (typeof node === 'function') {
    const samples = SAMPLES[path];
    if (!samples) missing.push(path);
    else for (const args of samples) out.push({ key: `${path}(${args.map((a) => JSON.stringify(a)).join(', ')})`, text: node(...args) });
  } else for (const [k, v] of Object.entries(node)) collect(v, path ? `${path}.${k}` : k, out, missing);
  return out;
}

const missing = [];
const texts = collect(ja, '', [], missing);
const base = await loadTextlintrc({ configFilePath: join(root, '.textlintrc'), node_modulesDir: join(root, 'node_modules') });
// 自作の規則（text/rules/）は .textlintrc では読めないので、ここで足す
const descriptor = base.concat(new TextlintKernelDescriptor({
  rules: [{ ruleId: 'no-plain-past', rule: noPlainPast, options: true }],
  plugins: [],
  filterRules: [],
}));
const linter = createLinter({ descriptor });

let count = 0;
for (const { key, text } of texts) {
  const result = await linter.lintText(text, 'ja.txt');
  for (const m of result.messages) {
    count++;
    console.log(`${key}\n  「${text}」\n  ${m.ruleId}：${m.message}`);
  }
}
for (const key of missing) console.log(`${key}：見本の引数がありません（scripts/lint-ja.mjs の SAMPLES に足してください）`);

const problems = count + missing.length;
if (problems) {
  console.log(`\n${texts.length} 件の文言のうち、指摘が ${problems} 件あります`);
  process.exit(1);
}
console.log(`${texts.length} 件の文言を検査しました。指摘はありません`);
