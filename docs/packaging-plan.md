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
| 対象 | Windows x64 だけ | 今の機能（PowerShell、`claude://`、Claude-Data）が Windows 専用 |

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

## 公開のルールとの関係（[publishing.md](publishing.md)）
- 作ったファイルは `app/release/` に出す。`.gitignore` の `release/` で git に入らない
- `author` と `copyright` は、公開してよい名前だけを書く。electron-builder の `copyright` の既定値には年が入るので、**年を書かずに**明示する
- NSIS の画面に出す「発行元」（`publisherName`）も同じ名前にする
- インストーラーの中身に、手元のパスやユーザー名が入らないことを確かめる（`dist/` を作り直してから包む。ソースマップは入れない）

## 進め方
1. **下ごしらえ**：`ICON` のパスを `app.isPackaged` で切り替える。`productName`、`appId`、`setAppUserModelId` を足す。`npm start` で今までどおり動くことを確かめる
2. **ポータブル版**：`electron-builder` を `devDependencies` に入れ、`npm run dist:dir`（`--dir`）で展開したフォルダを作る。exe を直接起動し、トレイのアイコン、ショートカット（`Ctrl+Alt+N`）、`claude://` で開く動き、設定の保存を確かめる
3. **インストーラー**：NSIS とポータブル（zip）を作る `npm run dist` を足す。インストール、起動、上書きインストール（設定が残るか）、アンインストール（設定を消すかどうかを聞く。既定は残す）を確かめる
4. **ログオン時の起動**：設定の項目を足す。インストール版でだけ有効にし、`npm start` のときは灰色にする
5. **配布**：GitHub Releases にインストーラーと zip を手で置く手順を書く。SmartScreen の警告の進み方を README に書く
6. あとで：署名、`electron-updater` による自動更新、arm64

## 足すファイルとスクリプト（案）
- `app/electron-builder.yml`：設定（`appId`、`productName`、`files`、`extraResources`、`win.target: [nsis, zip]`、`nsis.oneClick: false`、`nsis.perMachine: false`、`directories.output: release`）
- `app/package.json`：`"dist": "npm run build && electron-builder"`、`"dist:dir": "npm run build && electron-builder --dir"`
- 一番上の `package.json`：同じ名前で `app/` に渡すスクリプト
- `app/README.md`：作り方と、作ったファイルの場所

## 決めること
- `appId`（例：`io.github.<公開してよい名前>.bantus`）
- アンインストールのときに設定（`%APPDATA%\Bantus`）を消すか
- ポータブル版の設定を exe の隣に置くか（今の案は、インストール版と同じ `%APPDATA%`）
