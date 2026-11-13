# exe 化とインストーラーの計画

`app/` の Electron 版を、`npm start` なしで起動できる exe にし、インストーラーで配れるようにする計画です。

## 方針
| 項目 | 案 | 理由 |
|---|---|---|
| ツール | **electron-builder**（NSIS） | 設定が `package.json` か 1 つのファイルにまとまる。インストーラー、ポータブル版、自動更新（`electron-updater`）を同じ道具で作れる。Electron Forge（Squirrel）はインストール先やショートカットを選べず、アンインストールの動きもわかりにくい |
| インストール先 | **ユーザーごと**（`%LOCALAPPDATA%\Programs\Bantus`） | 管理者の権限がいらない。ウィジェットは 1 人で使う前提 |
| インストーラーの形 | 画面ありの NSIS（`oneClick: false`）。インストール先を変えられ、スタートメニューのショートカットを作る | 何が入るかが見える |
| ほかの形 | ポータブル版（zip）も同じビルドで作る | インストールしたくない人向け。試すときにも便利 |
| 署名 | 最初は**署名しない** | 費用がかかる。SmartScreen の警告が出ることを README に書く。利用者が増えたら考える |
| 自動更新 | 最初は**なし**。GitHub Releases に置き、手で入れ直す | 署名なしの自動更新は警告が毎回出る。仕組みが落ち着いてから足す |
| 対象 | Windows x64 だけ | 今の機能（Windows の API を呼ぶ補助プログラム、`claude://`、Claude-Data）が Windows 専用 |

## 今のコードで直すところ
| 場所 | 今 | exe にしたとき | 対応 |
|---|---|---|---|
| `app/src/main/main.ts` の `ICON` | `__dirname` から `assets/icon.ico` をたどる | asar の中に入る。`Tray` と `BrowserWindow` の `icon` は asar の中の .ico を読めないことがある | `assets/` を `extraResources` で外に出し、`app.isPackaged` なら `process.resourcesPath` から読む |
| `PRELOAD`、`WEB` | `dist/` の中の相対パス | `dist/` を asar に入れれば、そのまま動く | 変えない。`files` に `dist/node/**`、`dist/web/**` を入れ、`dist/test/**` は外す |
| アプリの名前 | `package.json` の `name` が `bantus`。`productName` がない | 設定の場所（`%APPDATA%\bantus`）は `productName` で決まる | `productName: "Bantus"` を足す。Windows はフォルダ名の大文字小文字を区別しないので、今の設定はそのまま使える |
| AppUserModelID | 設定していない | 通知やタスクバーでの見え方がインストールのたびに変わる | `appId` を決め、`app.setAppUserModelId()` で同じ値を設定する |
| `git` と `powershell.exe` | PATH から呼ぶ | exe でも同じ。git がない PC では変更の表示だけが出ない | 変えない。git がないときに落ちないことを確かめる |
| 二重起動の防止 | `requestSingleInstanceLock()` | インストール版と `npm start` を同時に動かせない | 開発中は `WIDGET_FIXTURE` か、別の `userData` で起動する（今のまま） |
| ログオン時の起動 | ない | インストールしたら欲しくなる | 設定の「全体」に「Windows の起動時に開く」を足す（`app.setLoginItemSettings`）。インストーラーでは聞かない |

## 公開のルールとの関係（[publishing.md](../publishing.md)）
- 作ったファイルは `app/release/` に出す。`.gitignore` の `release/` で git に入らない
- `author` と `copyright` は、公開してよい名前だけを書く。electron-builder の `copyright` の既定値には年が入るので、**年を書かずに**明示する
- NSIS の画面に出す「発行元」（`publisherName`）も同じ名前にする
- インストーラーの中身に、手元のパスやユーザー名が入らないことを確かめる（`dist/` を作り直してから包む。ソースマップは入れない）

## 進め方
1. **下ごしらえ**：`ICON` のパスを `app.isPackaged` で切り替える。`productName`、`appId`、`setAppUserModelId` を足す。`npm start` で今までどおり動くことを確かめる
2. **ポータブル版**：`electron-builder` を `devDependencies` に入れ、`npm run dist:dir`（`--dir`）で展開したフォルダを作る。exe を直接起動し、トレイのアイコン、ショートカット（`Ctrl+Alt+N`）、`claude://` で開く動き、設定の保存を確かめる
3. **インストーラー**：NSIS とポータブル（zip）を作る `npm run dist` を足す。インストール、起動、上書きインストール（設定が残るか）、アンインストール（設定は消さずに残す）を確かめる
4. **ログオン時の起動**：設定の項目を足す。インストール版でだけ有効にし、`npm start` のときは灰色にする
5. **配布**：GitHub Releases にインストーラーと zip を手で置く手順を書く。SmartScreen の警告の進み方を README に書く
6. あとで：署名、`electron-updater` による自動更新、arm64

## 足したファイルとスクリプト
- `app/electron-builder.yml`：設定（`appId`、`productName`、`copyright`、`files`、`extraResources`、`win.target: [nsis, zip]`、`nsis.oneClick: false`、`nsis.perMachine: false`、`directories.output: release`）。electron-builder 26 では `zip` という項目がないので、zip の名前は `win.artifactName`、インストーラーの名前は `nsis.artifactName` で決める
- 常駐の補助プログラム（`bantus-helper.exe`）は、`npm run dist` が `npm run build:native` でビルドし、`extraResources` で `resources/` に置く。MSVC がなければ `dist` は止まる（exe のないインストーラーは作らない）。[native-helper.md](native-helper.md)
- `app/package.json`：`"dist": "node scripts/clean-dist.mjs && npm run build && electron-builder"`、`"dist:dir"`（同じく `--dir`）。`productName: "Bantus"` と `author`
- `app/scripts/clean-dist.mjs`：包む前に `dist/` を消す（前のビルドの残りを入れない）
- 一番上の `package.json`：同じ名前で `app/` に渡すスクリプト
- `app/README.md`：作り方と、作ったファイルの場所
- `app/electron-builder.yml` の `extraFiles`：リポジトリの一番上の `LICENSE` を `LICENSE.txt` に、`THIRD_PARTY_NOTICES.txt` をそのままの名前で、インストール先の一番上（`Bantus.exe` の隣）に置く。MIT と ISC は「すべての複製に表記を入れる」ことが条件なので、配るものすべて（インストーラー、zip、`win-unpacked/`）に入れる。`app/` の外のファイルなので `from: ../LICENSE` のように書く。拡張子を `.txt` にするのは、ダブルクリックでメモ帳が開くようにするため
- `nsis.license: ../LICENSE`：インストーラーの最初に MIT の使用許諾の画面を出す。画面が 1 つ増え、「同意する」を押す操作が増える

## 決めたこと
| 項目 | 決めたこと |
|---|---|
| `appId` | `io.github.hectarebase.bantus`（git の `user.name` を小文字にしたもの）。`src/main/main.ts` の `APP_USER_MODEL_ID` も同じ値 |
| `author`、`copyright`、`publisherName` | 公開してよい名前（git の `user.name`）だけ。`copyright` は年なしの `Copyright © <名前>` |
| electron-builder の版 | 26.17.0（出てから 2 週間以上たった版） |
| アンインストール | 設定（`%APPDATA%Bantus`）は消さない（`deleteAppDataOnUninstall: false`）。消すかを聞く画面は作らない |
| ポータブル版の設定 | インストール版と同じ `%APPDATA%Bantus` |
| 使用許諾と第三者の表記 | `LICENSE.txt` と `THIRD_PARTY_NOTICES.txt` を `Bantus.exe` の隣に置く。インストーラーでは MIT の使用許諾の画面を出す |
| 言語ファイル | Electron の言語ファイルは `ja` と `en-US` だけを入れる |
| ログオン時の起動 | 設定の「全体」→「起動」。インストール版（zip も含む）でだけ使え、`npm start` と見本データのときは灰色。起動したときに Windows の登録（`getLoginItemSettings`）を読んで設定に写す |

## 確かめた結果（Electron 44.9.0、electron-builder 26.17.0、Windows 11 x64）
| 確かめたこと | 結果 |
|---|---|
| `npm run typecheck`、`npm test` | 通る（131 件） |
| 見本データでの `npm start` 相当の起動（`npm run debug`） | 今までどおり表示される |
| `npm run dist:dir`、`npm run dist` | `app/release/` に `Bantus-Setup-0.1.0.exe`（約 107MB）、`Bantus-0.1.0-win-x64.zip`（約 135MB）、`win-unpacked/` ができる。`release/` は `.gitignore` で git に入らない |
| asar の中身 | `dist/node/`、`dist/web/`、`package.json` の 35 項目だけ。ソースマップとテストはない。ユーザーフォルダのパスやユーザー名は入っていない |
| exe の起動（見本データ、別のデータフォルダ） | `app.isPackaged` が true、名前は `Bantus`、データフォルダは `%APPDATA%Bantus-debug`。`resources/assets/icon.ico` を読めて空でない。ウィジェットが表示される。ピンの切り替えが `settings.json` に保存される |
| 「Windows の起動時に開く」（exe、`--user-data-dir` で別のデータフォルダ） | オンにすると `getLoginItemSettings().openAtLogin` が true になり、設定にも保存される。オフで両方 false に戻る |
| 「Windows の起動時に開く」（`npm start` 相当） | 灰色で押せない |
| インストール（`/S` で画面なし） | `%LOCALAPPDATA%ProgramsBantus` に入る。「アプリと機能」に `Bantus 0.1.0`、発行元 `HectareBase` で出る（`HKCU` の Uninstall なのでユーザーごと）。スタートメニューに `Bantus.lnk` ができる |
| インストール版の起動（`--user-data-dir` で別のデータフォルダ） | 動く。「Windows の起動時に開く」の登録先は、インストールした `Bantus.exe` |
| 上書きインストール | 「アプリと機能」の項目は 1 つのまま。`%APPDATA%Bantussettings.json` は変わらない |
| アンインストール（`/S`） | インストール先のフォルダ、「アプリと機能」の項目、スタートメニューのショートカットが消える。`%APPDATA%Bantussettings.json` は残り、中身も変わらない |

### Electron 44.10.1 に上げたあと
高の脆弱性（GHSA-jr5w-w6x2-84p9）を直すため、Electron を 44.9.0 から 44.10.1 に上げた。上の表は 44.9.0 で確かめたもの。44.10.1 では次を確かめた。

| 確かめたこと | 結果 |
|---|---|
| `npm run typecheck`、`npm test` | 通る（131 件） |
| `npm audit` | electron の件が消え、ビルドのときだけ使う minimatch 系の中 15 件だけが残る |
| `npm run dist:dir` で作った exe の起動 | ウィジェットが表示される。トレイのアイコンが登録される（隠れているアイコンの中） |

### 使用許諾と第三者の表記を入れたあと
| 確かめたこと | 結果 |
|---|---|
| `npm run dist:dir` | `win-unpacked/` の一番上に `LICENSE.txt` と `THIRD_PARTY_NOTICES.txt` ができ、中身はリポジトリの一番上のものと同じ |
| `npm run dist` | インストーラーと zip ができる。zip の一番上に 2 つのファイルが入っている。インストーラーの NSIS スクリプトに使用許諾の画面（`MUI_PAGE_LICENSE`）が入る。インストーラーの中身は `win-unpacked/` を包んだものなので、同じ 2 つが入る |

### まだ確かめていないこと
- `Ctrl+Alt+N`：いつものウィジェット（`npm start`）が動いていてキーを使っているため、exe では登録できなかった（想定どおり）。いつものウィジェットを止めて確かめる
- トレイのアイコンの見た目（タスクバーが隠れていて画面で見られなかった。アイコンのファイルを読めることは確かめた）
- インストーラーの画面（`/S` で画面なしだけを試した）
- セッションを開く動き（`WM_COPYDATA` は常駐させた補助プログラムから送り、予備のリンクは `shell.openExternal` なので、exe でも変わらない見込み）
