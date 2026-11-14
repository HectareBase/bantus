// 常駐の PowerShell（src/main/foreground.ts と src/main/appbar.ts のスクリプト）の代わりに動く、小さな常駐プログラム（試作）。
// 1 行の命令に 1 行で答える。命令と答えの形は PowerShell のスクリプトとまったく同じにする。違いを足すときは両方を直す。
//
// 起動の引数
// - なし：foreground.ts の命令（fg、raise、open、wins、front、icon、sink）
// - appbar：appbar.ts の命令（new、query、set、remove）。標準入力が閉じたら、登録したままのものを外してから終わる
//
// コンソールのないプログラム（/SUBSYSTEM:WINDOWS）にする。コンソールのプログラムだと、隠していても conhost.exe が 1 つ付いてくる。
// 標準入力と標準出力は親（Electron）が渡したパイプをそのまま使う。
// ビルドは scripts/build-native.mjs（npm run build:native）。docs/design/native-helper.md

#define WIN32_LEAN_AND_MEAN
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <shellapi.h>
#include <dwmapi.h>
#include <tlhelp32.h>
#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "dwmapi.lib")

// ---- 文字列を組み立てる ----

typedef struct {
  char *p;
  size_t n, cap;
} Buf;

static void buf_need(Buf *b, size_t more) {
  if (b->n + more + 1 <= b->cap) return;
  size_t cap = b->cap ? b->cap : 256;
  while (cap < b->n + more + 1) cap *= 2;
  char *p = (char *)realloc(b->p, cap);
  if (!p) ExitProcess(1);
  b->p = p;
  b->cap = cap;
}

static void buf_add(Buf *b, const char *s, size_t n) {
  buf_need(b, n);
  memcpy(b->p + b->n, s, n);
  b->n += n;
  b->p[b->n] = 0;
}

static void buf_str(Buf *b, const char *s) { buf_add(b, s, strlen(s)); }

static void buf_fmt(Buf *b, const char *fmt, ...) {
  char tmp[128];
  va_list ap;
  va_start(ap, fmt);
  int n = _vsnprintf_s(tmp, sizeof tmp, _TRUNCATE, fmt, ap);
  va_end(ap);
  if (n > 0) buf_add(b, tmp, (size_t)n);
}

static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static void buf_b64(Buf *b, const unsigned char *s, size_t n) {
  buf_need(b, (n + 2) / 3 * 4);
  for (size_t i = 0; i < n; i += 3) {
    unsigned v = (unsigned)s[i] << 16;
    if (i + 1 < n) v |= (unsigned)s[i + 1] << 8;
    if (i + 2 < n) v |= s[i + 2];
    char q[4] = {B64[(v >> 18) & 63], B64[(v >> 12) & 63], i + 1 < n ? B64[(v >> 6) & 63] : '=', i + 2 < n ? B64[v & 63] : '='};
    buf_add(b, q, 4);
  }
}

/** UTF-16 を UTF-8 にして base64 で足す。対になっていないサロゲートは U+FFFD になる（.NET の Encoding.UTF8 と同じ） */
static void buf_b64w(Buf *b, const wchar_t *s, int len) {
  if (len <= 0) return;
  int n = WideCharToMultiByte(CP_UTF8, 0, s, len, NULL, 0, NULL, NULL);
  if (n <= 0) return;
  char *u = (char *)malloc((size_t)n);
  if (!u) return;
  WideCharToMultiByte(CP_UTF8, 0, s, len, u, n, NULL, NULL);
  buf_b64(b, (unsigned char *)u, (size_t)n);
  free(u);
}

/** base64 を読む。正しくない形なら -1（Convert.FromBase64String が例外を投げる場面） */
static int b64_decode(const char *s, unsigned char **out, size_t *outLen) {
  size_t len = strlen(s);
  if (len % 4) return -1;
  unsigned char *o = (unsigned char *)malloc(len / 4 * 3 + 1);
  if (!o) return -1;
  size_t n = 0;
  for (size_t i = 0; i < len; i += 4) {
    unsigned v = 0;
    int pad = 0;
    for (int k = 0; k < 4; k++) {
      char c = s[i + k];
      const char *at = c ? strchr(B64, c) : NULL;
      if (c == '=' && i + 4 == len && k >= 2) {
        pad++;
        v <<= 6;
      } else if (at && !pad) {
        v = (v << 6) | (unsigned)(at - B64);
      } else {
        free(o);
        return -1;
      }
    }
    o[n++] = (unsigned char)(v >> 16);
    if (pad < 2) o[n++] = (unsigned char)(v >> 8);
    if (pad < 1) o[n++] = (unsigned char)v;
  }
  o[n] = 0;
  *out = o;
  *outLen = n;
  return 0;
}

// ---- 標準入力と標準出力 ----

static HANDLE stdIn, stdOut;
static char *inBuf;
static size_t inLen, inCap, inUsed;

/** 1 行読む（改行は外す）。入力が閉じて、もう読むものがなければ NULL。最後の行に改行がなくても返す（ReadLine と同じ） */
static char *read_line(void) {
  if (inUsed) {
    memmove(inBuf, inBuf + inUsed, inLen - inUsed);
    inLen -= inUsed;
    inUsed = 0;
  }
  for (;;) {
    char *nl = inLen ? (char *)memchr(inBuf, '\n', inLen) : NULL;
    if (nl) {
      *nl = 0;
      inUsed = (size_t)(nl - inBuf) + 1;
      return inBuf;
    }
    if (inLen + 4096 + 1 > inCap) {
      inCap = inCap ? inCap * 2 : 8192;
      char *p = (char *)realloc(inBuf, inCap);
      if (!p) ExitProcess(1);
      inBuf = p;
    }
    DWORD got = 0;
    if (!ReadFile(stdIn, inBuf + inLen, 4096, &got, NULL) || got == 0) {
      if (!inLen) return NULL;
      inBuf[inLen] = 0;
      inUsed = inLen;
      return inBuf;
    }
    inLen += got;
  }
}

static void write_line(Buf *b) {
  buf_add(b, "\n", 1);
  DWORD wrote;
  size_t at = 0;
  while (at < b->n) {
    if (!WriteFile(stdOut, b->p + at, (DWORD)(b->n - at), &wrote, NULL) || wrote == 0) ExitProcess(0);
    at += wrote;
  }
}

/** 前後の空白（スペース、タブ、CR）を外す（String.Trim の代わり。命令は ASCII だけ） */
static char *trim(char *s) {
  while (*s == ' ' || *s == '\t' || *s == '\r') s++;
  size_t n = strlen(s);
  while (n && (s[n - 1] == ' ' || s[n - 1] == '\t' || s[n - 1] == '\r')) s[--n] = 0;
  return s;
}

/** 10 進の整数を読む（long.TryParse の代わり）。全部が数字（先頭の符号はよい）でなければ 0 を返す */
static int parse_i64(const char *s, long long *v) {
  if (!*s) return 0;
  char *end;
  errno = 0;
  long long x = _strtoi64(s, &end, 10);
  if (*end || errno) return 0;
  *v = x;
  return 1;
}

/** 「数 数」の 2 語を読む。PowerShell の -split ' ' と同じく、ちょうど 1 つのスペースで区切られた 2 つでなければ 0 */
static int parse_two(char *arg, long long *a, long long *b) {
  if (!arg) return 0;
  char *sp = strchr(arg, ' ');
  if (!sp || strchr(sp + 1, ' ')) return 0;
  *sp = 0;
  int ok = parse_i64(arg, a) && parse_i64(sp + 1, b);
  *sp = ' ';
  return ok;
}

// ---- プロセス ----

/** 実行ファイルのパス（wchar）と起動時刻。開けなければ空、起動時刻は 0 */
static void exe_path(DWORD pid, wchar_t *path, DWORD cap, long long *created) {
  path[0] = 0;
  if (created) *created = 0;
  HANDLE p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!p) return;
  DWORD size = cap;
  if (!QueryFullProcessImageNameW(p, 0, path, &size)) path[0] = 0;
  if (created) {
    FILETIME c, e, k, u;
    if (GetProcessTimes(p, &c, &e, &k, &u)) *created = (long long)(((unsigned long long)c.dwHighDateTime << 32) | c.dwLowDateTime);
  }
  CloseHandle(p);
}

/** パスのファイル名から拡張子を外したもの（Path.GetFileNameWithoutExtension） */
static const wchar_t *base_name(const wchar_t *path, size_t *len) {
  const wchar_t *slash = wcsrchr(path, L'\\');
  const wchar_t *name = slash ? slash + 1 : path;
  const wchar_t *dot = wcsrchr(name, L'.');
  *len = dot ? (size_t)(dot - name) : wcslen(name);
  return name;
}

/** Get-Process の ProcessName（実行ファイルの名前から .exe を外したもの）。開けないプロセスは一覧（Toolhelp）から引く */
static void process_name(DWORD pid, wchar_t *name, size_t cap) {
  name[0] = 0;
  if (pid == 0) {
    wcscpy_s(name, cap, L"Idle");
    return;
  }
  wchar_t path[MAX_PATH * 4];
  exe_path(pid, path, MAX_PATH * 4, NULL);
  const wchar_t *file = NULL;
  if (path[0]) {
    const wchar_t *slash = wcsrchr(path, L'\\');
    file = slash ? slash + 1 : path;
    wcscpy_s(name, cap, file);
  } else {
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return;
    PROCESSENTRY32W e = {sizeof e};
    for (BOOL ok = Process32FirstW(snap, &e); ok; ok = Process32NextW(snap, &e)) {
      if (e.th32ProcessID == pid) {
        wcscpy_s(name, cap, e.szExeFile);
        break;
      }
    }
    CloseHandle(snap);
  }
  size_t n = wcslen(name);
  if (n > 4 && _wcsicmp(name + n - 4, L".exe") == 0) name[n - 4] = 0;
}

static void fg_name(wchar_t *name, size_t cap) {
  DWORD pid = 0;
  GetWindowThreadProcessId(GetForegroundWindow(), &pid);
  process_name(pid, name, cap);
}

static void add_wide_utf8(Buf *b, const wchar_t *s) {
  int n = WideCharToMultiByte(CP_UTF8, 0, s, -1, NULL, 0, NULL, NULL);
  if (n <= 1) return;
  buf_need(b, (size_t)n);
  WideCharToMultiByte(CP_UTF8, 0, s, -1, b->p + b->n, n, NULL, NULL);
  b->n += (size_t)n - 1;
}

/** 割り当てのない仮想キー 0x88 を押して離したことにする（前面の切り替えの制限を外す。foreground.ts のコメント） */
static void tap_unassigned_key(void) {
  keybd_event(0x88, 0, 0, 0);
  keybd_event(0x88, 0, KEYEVENTF_KEYUP, 0);
}

static BOOL set_foreground(HWND h) {
  BOOL ok = SetForegroundWindow(h);
  if (!ok) {
    tap_unassigned_key();
    ok = SetForegroundWindow(h);
  }
  return ok;
}

// ---- raise ----

/** Get-Process -Name claude の MainWindowHandle：claude のプロセスの、見えていて所有者のない最初のウィンドウ */
static BOOL CALLBACK find_claude(HWND h, LPARAM l) {
  if (!IsWindowVisible(h) || GetWindow(h, GW_OWNER)) return TRUE;
  DWORD pid = 0;
  GetWindowThreadProcessId(h, &pid);
  wchar_t name[MAX_PATH];
  process_name(pid, name, MAX_PATH);
  if (_wcsicmp(name, L"claude") != 0) return TRUE;
  *(HWND *)l = h;
  return FALSE;
}

static void cmd_raise(Buf *b) {
  HWND h = NULL;
  EnumWindows(find_claude, (LPARAM)&h);
  if (!h) {
    buf_str(b, "0");
    return;
  }
  if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
  BOOL ok = set_foreground(h);
  wchar_t name[MAX_PATH];
  fg_name(name, MAX_PATH);
  buf_str(b, ok && _wcsicmp(name, L"claude") == 0 ? "1" : "0");
}

// ---- open ----

static int valid_id(const char *id) {
  if (strncmp(id, "local_", 6) != 0) return 0;
  const char *s = id + 6;
  size_t n = strlen(s);
  if (n != 36) return 0;
  for (size_t i = 0; i < n; i++) {
    char c = s[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F') || c == '-')) return 0;
  }
  return 1;
}

static wchar_t *utf8_to_wide(const char *s) {
  int n = MultiByteToWideChar(CP_UTF8, 0, s, -1, NULL, 0);
  if (n <= 0) return NULL;
  wchar_t *w = (wchar_t *)malloc((size_t)n * sizeof(wchar_t));
  if (w) MultiByteToWideChar(CP_UTF8, 0, s, -1, w, n);
  return w;
}

static int send_open(const char *id, const char *dir) {
  wchar_t *title = utf8_to_wide(dir);
  if (!title) return 0;
  HWND h = FindWindowExW(HWND_MESSAGE, NULL, L"Chrome_MessageWindow", title);
  free(title);
  if (!h) return 0;
  DWORD owner = 0;
  GetWindowThreadProcessId(h, &owner);
  wchar_t exe[MAX_PATH * 4];
  exe_path(owner, exe, MAX_PATH * 4, NULL);
  if (!exe[0]) return 0;
  tap_unassigned_key();
  AllowSetForegroundWindow(owner);
  // "START\0<SystemRoot>\0\"<exe>\" claude://claude.ai/epitaxy/<id>\0" のあとに、さらに 0 を 2 バイト
  wchar_t root[MAX_PATH];
  DWORD rn = GetEnvironmentVariableW(L"SystemRoot", root, MAX_PATH);
  if (rn == 0 || rn >= MAX_PATH) root[0] = 0;
  wchar_t idw[64];
  MultiByteToWideChar(CP_UTF8, 0, id, -1, idw, 64);
  size_t cap = 16 + wcslen(root) + wcslen(exe) + 64 + 64;
  wchar_t *msg = (wchar_t *)calloc(cap, sizeof(wchar_t));
  if (!msg) return 0;
  size_t n = 0;
  n += (size_t)swprintf_s(msg + n, cap - n, L"START") + 1;
  n += (size_t)swprintf_s(msg + n, cap - n, L"%s", root) + 1;
  n += (size_t)swprintf_s(msg + n, cap - n, L"\"%s\" claude://claude.ai/epitaxy/%s", exe, idw) + 1;
  COPYDATASTRUCT data = {0, (DWORD)((n + 1) * sizeof(wchar_t)), msg};
  DWORD_PTR result = 0;
  LRESULT sent = SendMessageTimeoutW(h, WM_COPYDATA, 0, (LPARAM)&data, SMTO_ABORTIFHUNG, 1000, &result);
  free(msg);
  return sent != 0 && result != 0;
}

static void cmd_open(Buf *b, const char *arg) {
  unsigned char *raw;
  size_t len;
  if (!arg || b64_decode(arg, &raw, &len) != 0) {
    buf_str(b, "0");
    return;
  }
  char *text = (char *)raw;
  char *nl = strchr(text, '\n');
  if (nl) *nl = 0;
  int ok = 0;
  if (valid_id(text) && nl) {
    char *dir = nl + 1;
    while (!ok && dir) {
      char *next = strchr(dir, '\n');
      if (next) *next++ = 0;
      if (*dir) ok = send_open(text, dir);
      dir = next;
    }
  }
  free(raw);
  buf_str(b, ok ? "1" : "0");
}

// ---- wins と front ----

static BOOL on_taskbar(HWND h) {
  if (!IsWindowVisible(h)) return FALSE;
  LONG ex = GetWindowLongW(h, GWL_EXSTYLE);
  if (ex & WS_EX_TOOLWINDOW) return FALSE;
  if (!(ex & WS_EX_APPWINDOW) && ((ex & WS_EX_NOACTIVATE) || GetWindow(h, GW_OWNER))) return FALSE;
  int cloaked = 0;
  if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, &cloaked, sizeof cloaked) == S_OK && cloaked) return FALSE;
  return GetPropW(h, L"ITaskList_Deleted") == NULL;
}

typedef struct {
  DWORD selfPid;
  HWND first;
} FrontCtx;

static BOOL CALLBACK find_front(HWND h, LPARAM l) {
  FrontCtx *c = (FrontCtx *)l;
  DWORD pid = 0;
  GetWindowThreadProcessId(h, &pid);
  if (pid == c->selfPid || IsIconic(h) || (GetWindowLongW(h, GWL_EXSTYLE) & WS_EX_TOPMOST) || !on_taskbar(h) || GetWindowTextLengthW(h) == 0) return TRUE;
  c->first = h;
  return FALSE;
}

/** 前面とみなすウィンドウ（foreground.ts の FrontWindow） */
static HWND front_window(DWORD selfPid) {
  HWND fg = GetForegroundWindow();
  if (fg) {
    DWORD pid = 0;
    GetWindowThreadProcessId(fg, &pid);
    if (pid != selfPid) {
      HWND root = GetAncestor(fg, GA_ROOTOWNER);
      return root ? root : fg;
    }
  }
  FrontCtx c = {selfPid, NULL};
  EnumWindows(find_front, (LPARAM)&c);
  return c.first;
}

#define MAX_PIDS 512
typedef struct {
  HWND self;
  DWORD selfPid;
  HMONITOR monitor;
  HWND front;
  Buf *out;
  int count;
  DWORD pids[MAX_PIDS];
  wchar_t *paths[MAX_PIDS];
  long long times[MAX_PIDS];
} ListCtx;

static BOOL CALLBACK list_one(HWND h, LPARAM l) {
  ListCtx *c = (ListCtx *)l;
  if (h == c->self || !on_taskbar(h)) return TRUE;
  wchar_t text[512];
  int tlen = GetWindowTextW(h, text, 512);
  if (tlen == 0) return TRUE;
  DWORD pid = 0;
  GetWindowThreadProcessId(h, &pid);
  if (pid == c->selfPid) return TRUE;
  BOOL min = IsIconic(h);
  HMONITOR m;
  if (min) {
    WINDOWPLACEMENT wp = {sizeof wp};
    if (!GetWindowPlacement(h, &wp)) return TRUE;
    m = MonitorFromRect(&wp.rcNormalPosition, MONITOR_DEFAULTTONEAREST);
  } else {
    m = MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST);
  }
  if (m != c->monitor) return TRUE;
  const wchar_t *path = L"";
  long long created = 0;
  int i;
  for (i = 0; i < c->count && c->pids[i] != pid; i++) {
  }
  if (i < c->count) {
    path = c->paths[i];
    created = c->times[i];
  } else {
    wchar_t buf[1024];
    exe_path(pid, buf, 1024, &created);
    wchar_t *copy = _wcsdup(buf);
    if (c->count < MAX_PIDS && copy) {
      c->pids[c->count] = pid;
      c->paths[c->count] = copy;
      c->times[c->count] = created;
      c->count++;
      path = copy;
    } else {
      free(copy);
      path = L"";
    }
  }
  if (path[0]) {
    size_t blen;
    const wchar_t *base = base_name(path, &blen);
    if (blen == 6 && _wcsnicmp(base, L"claude", 6) == 0) return TRUE;
  }
  if (tlen > 200) tlen = 200;
  Buf *b = c->out;
  buf_fmt(b, ";%lld:%c:%c:%lld:", (long long)(INT_PTR)h, min ? '1' : '0', h == c->front ? '1' : '0', created);
  buf_b64w(b, path, (int)wcslen(path));
  buf_add(b, ":", 1);
  buf_b64w(b, text, tlen);
  return TRUE;
}

static void cmd_wins(Buf *b, char *arg) {
  long long h, pid;
  if (!parse_two(arg, &h, &pid) || pid < 0 || pid > 0xFFFFFFFFLL) return;
  ListCtx *c = (ListCtx *)calloc(1, sizeof(ListCtx));
  if (!c) return;
  c->self = (HWND)(INT_PTR)h;
  c->selfPid = (DWORD)pid;
  c->monitor = MonitorFromWindow(c->self, MONITOR_DEFAULTTONEAREST);
  c->front = front_window(c->selfPid);
  c->out = b;
  buf_str(b, "W");
  EnumWindows(list_one, (LPARAM)c);
  for (int i = 0; i < c->count; i++) free(c->paths[i]);
  free(c);
}

static void cmd_front(Buf *b, char *arg) {
  long long n, pid;
  if (!parse_two(arg, &n, &pid) || pid < 0 || pid > 0xFFFFFFFFLL) {
    buf_str(b, "0");
    return;
  }
  HWND h = (HWND)(INT_PTR)n;
  if (!IsWindow(h)) {
    buf_str(b, "0");
    return;
  }
  if (!IsIconic(h) && front_window((DWORD)pid) == h) {
    ShowWindow(h, SW_MINIMIZE);
    buf_str(b, "2");
    return;
  }
  if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
  buf_str(b, set_foreground(h) ? "1" : "0");
}

// 最前面でないウィンドウの一番下へ送る（全画面のアプリが開いたとき。HWND_NOTOPMOST だけでは一番上に残る）
static void cmd_sink(Buf *b, char *arg) {
  long long n;
  if (!arg || !parse_i64(arg, &n)) {
    buf_str(b, "0");
    return;
  }
  HWND h = (HWND)(INT_PTR)n;
  BOOL ok = IsWindow(h) && SetWindowPos(h, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
  buf_str(b, ok ? "1" : "0");
}

// ---- icon（PNG に書き出す） ----

static unsigned long crc_table[256];

static void crc_init(void) {
  for (unsigned long n = 0; n < 256; n++) {
    unsigned long c = n;
    for (int k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320UL ^ (c >> 1) : c >> 1;
    crc_table[n] = c;
  }
}

static unsigned long crc(const unsigned char *p, size_t n, unsigned long c) {
  for (size_t i = 0; i < n; i++) c = crc_table[(c ^ p[i]) & 0xFF] ^ (c >> 8);
  return c;
}

static void put32(Buf *b, unsigned long v) {
  unsigned char q[4] = {(unsigned char)(v >> 24), (unsigned char)(v >> 16), (unsigned char)(v >> 8), (unsigned char)v};
  buf_add(b, (char *)q, 4);
}

static void png_chunk(Buf *png, const char *type, const unsigned char *data, size_t n) {
  put32(png, (unsigned long)n);
  size_t at = png->n;
  buf_add(png, type, 4);
  if (n) buf_add(png, (const char *)data, n);
  put32(png, crc((unsigned char *)png->p + at, n + 4, 0xFFFFFFFFUL) ^ 0xFFFFFFFFUL);
}

/**
 * RGBA の画素を PNG にする。圧縮はせず、zlib の「そのまま入れる」ブロック（stored）だけで包む。
 * アイコンは 16〜32px なので、大きさは数 KB で済む。圧縮の部品（GDI+ や WIC）を読み込まずに済ませるため
 */
static void png_encode(Buf *png, const unsigned char *rgba, int w, int h) {
  size_t row = (size_t)w * 4 + 1;
  size_t raw = row * (size_t)h;
  unsigned char *pix = (unsigned char *)malloc(raw);
  if (!pix) return;
  for (int y = 0; y < h; y++) {
    pix[row * y] = 0;
    memcpy(pix + row * y + 1, rgba + (size_t)w * 4 * y, (size_t)w * 4);
  }
  size_t blocks = raw / 65535 + 1;
  size_t zlen = 2 + raw + blocks * 5 + 4;
  unsigned char *z = (unsigned char *)malloc(zlen);
  if (!z) {
    free(pix);
    return;
  }
  size_t zn = 0;
  z[zn++] = 0x78;
  z[zn++] = 0x01;
  size_t left = raw, at = 0;
  do {
    size_t take = left > 65535 ? 65535 : left;
    z[zn++] = take == left ? 1 : 0;
    z[zn++] = (unsigned char)take;
    z[zn++] = (unsigned char)(take >> 8);
    z[zn++] = (unsigned char)~take;
    z[zn++] = (unsigned char)(~take >> 8);
    memcpy(z + zn, pix + at, take);
    zn += take;
    at += take;
    left -= take;
  } while (left);
  unsigned long a = 1, s2 = 0;
  for (size_t i = 0; i < raw; i++) {
    a = (a + pix[i]) % 65521;
    s2 = (s2 + a) % 65521;
  }
  unsigned long adler = (s2 << 16) | a;
  z[zn++] = (unsigned char)(adler >> 24);
  z[zn++] = (unsigned char)(adler >> 16);
  z[zn++] = (unsigned char)(adler >> 8);
  z[zn++] = (unsigned char)adler;
  static const unsigned char sig[8] = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
  buf_add(png, (const char *)sig, 8);
  unsigned char ihdr[13] = {(unsigned char)(w >> 24), (unsigned char)(w >> 16), (unsigned char)(w >> 8), (unsigned char)w,
                            (unsigned char)(h >> 24), (unsigned char)(h >> 16), (unsigned char)(h >> 8), (unsigned char)h,
                            8, 6, 0, 0, 0};
  png_chunk(png, "IHDR", ihdr, 13);
  png_chunk(png, "IDAT", z, zn);
  png_chunk(png, "IEND", NULL, 0);
  free(z);
  free(pix);
}

/** DIB を 32bpp（上から下）で読む */
static unsigned char *dib_pixels(HDC dc, HBITMAP bmp, int w, int h) {
  unsigned char *px = (unsigned char *)malloc((size_t)w * h * 4);
  if (!px) return NULL;
  BITMAPINFO bi = {0};
  bi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  bi.bmiHeader.biWidth = w;
  bi.bmiHeader.biHeight = -h;
  bi.bmiHeader.biPlanes = 1;
  bi.bmiHeader.biBitCount = 32;
  bi.bmiHeader.biCompression = BI_RGB;
  if (GetDIBits(dc, bmp, 0, (UINT)h, px, &bi, DIB_RGB_COLORS) != h) {
    free(px);
    return NULL;
  }
  return px;
}

/** アイコンを RGBA にして PNG で書く。アルファがある絵はそのまま、ない絵はマスクで透明にする（Icon.ToBitmap と同じ見た目） */
static int icon_png(HICON icon, Buf *png) {
  ICONINFO ii;
  if (!GetIconInfo(icon, &ii)) return 0;
  int ok = 0;
  BITMAP bm;
  if (ii.hbmColor && GetObjectW(ii.hbmColor, sizeof bm, &bm) && bm.bmWidth > 0 && bm.bmHeight > 0 && bm.bmWidth <= 256 && bm.bmHeight <= 256) {
    int w = bm.bmWidth, h = bm.bmHeight;
    HDC dc = GetDC(NULL);
    unsigned char *px = dib_pixels(dc, ii.hbmColor, w, h);
    if (px) {
      size_t count = (size_t)w * h;
      int alpha = 0;
      for (size_t i = 0; i < count && !alpha; i++) alpha = px[i * 4 + 3] != 0;
      unsigned char *mask = alpha ? NULL : dib_pixels(dc, ii.hbmMask, w, h);
      for (size_t i = 0; i < count; i++) {
        unsigned char *p = px + i * 4;
        unsigned char t = p[0];
        p[0] = p[2];
        p[2] = t;
        if (!alpha) p[3] = mask && mask[i * 4] ? 0 : 255;
      }
      free(mask);
      png_encode(png, px, w, h);
      ok = png->n > 0;
      free(px);
    }
    ReleaseDC(NULL, dc);
  }
  if (ii.hbmColor) DeleteObject(ii.hbmColor);
  if (ii.hbmMask) DeleteObject(ii.hbmMask);
  return ok;
}

static HICON icon_message(HWND h, int which) {
  DWORD_PTR r = 0;
  return SendMessageTimeoutW(h, WM_GETICON, (WPARAM)which, 0, SMTO_ABORTIFHUNG, 200, &r) == 0 ? NULL : (HICON)r;
}

static void cmd_icon(Buf *b, char *arg) {
  if (!arg) return;
  char *sp = strchr(arg, ' ');
  if (!sp || strchr(sp + 1, ' ')) return;
  *sp = 0;
  long long n;
  if (!parse_i64(arg, &n)) return;
  BOOL big = strcmp(sp + 1, "1") == 0;
  HWND h = (HWND)(INT_PTR)n;
  if (!IsWindow(h)) return;
  static const int bigOrder[] = {ICON_BIG, GCLP_HICON, ICON_SMALL2, ICON_SMALL, GCLP_HICONSM};
  static const int smallOrder[] = {ICON_SMALL2, ICON_SMALL, GCLP_HICONSM, ICON_BIG, GCLP_HICON};
  const int *order = big ? bigOrder : smallOrder;
  HICON icon = NULL;
  for (int i = 0; i < 5 && !icon; i++) icon = order[i] >= 0 ? icon_message(h, order[i]) : (HICON)GetClassLongPtrW(h, order[i]);
  if (!icon) return;
  Buf png = {0};
  if (icon_png(icon, &png)) buf_b64(b, (unsigned char *)png.p, png.n);
  free(png.p);
}

// ---- 命令の振り分け ----

static void run_foreground(void) {
  crc_init();
  Buf out = {0};
  char *line;
  while ((line = read_line()) != NULL) {
    out.n = 0;
    buf_need(&out, 0);
    out.p[0] = 0;
    char *cmd = trim(line);
    char *arg = strchr(cmd, ' ');
    if (arg) *arg++ = 0;
    if (strcmp(cmd, "raise") == 0) cmd_raise(&out);
    else if (strcmp(cmd, "open") == 0) cmd_open(&out, arg);
    else if (strcmp(cmd, "wins") == 0) cmd_wins(&out, arg);
    else if (strcmp(cmd, "front") == 0) cmd_front(&out, arg);
    else if (strcmp(cmd, "icon") == 0) cmd_icon(&out, arg);
    else if (strcmp(cmd, "sink") == 0) cmd_sink(&out, arg);
    else {
      wchar_t name[MAX_PATH];
      fg_name(name, MAX_PATH);
      add_wide_utf8(&out, name);
    }
    write_line(&out);
  }
}

static APPBARDATA appbar_data(long long h) {
  APPBARDATA d = {0};
  d.cbSize = sizeof d;
  d.hWnd = (HWND)(INT_PTR)h;
  return d;
}

static void run_appbar(void) {
  long long bar = 0;
  Buf out = {0};
  char *line;
  while ((line = read_line()) != NULL) {
    out.n = 0;
    buf_need(&out, 0);
    out.p[0] = 0;
    char cmd[16] = {0};
    long long h = 0;
    unsigned edge = 0;
    int l = 0, t = 0, r = 0, bo = 0;
    int got = sscanf_s(trim(line), "%15s %lld %u %d %d %d %d", cmd, (unsigned)sizeof cmd, &h, &edge, &l, &t, &r, &bo);
    if (got == 2 && strcmp(cmd, "new") == 0) {
      bar = h;
      APPBARDATA d = appbar_data(h);
      d.uCallbackMessage = RegisterWindowMessageW(L"BantusAppBarCallback");
      SHAppBarMessage(ABM_NEW, &d);
      buf_fmt(&out, "%u %u", d.uCallbackMessage, RegisterWindowMessageW(L"TaskbarCreated"));
    } else if (got == 7 && (strcmp(cmd, "query") == 0 || strcmp(cmd, "set") == 0)) {
      APPBARDATA d = appbar_data(h);
      d.uEdge = edge;
      d.rc.left = l;
      d.rc.top = t;
      d.rc.right = r;
      d.rc.bottom = bo;
      SHAppBarMessage(cmd[0] == 'q' ? ABM_QUERYPOS : ABM_SETPOS, &d);
      buf_fmt(&out, "%ld %ld %ld %ld", d.rc.left, d.rc.top, d.rc.right, d.rc.bottom);
    } else if (got == 2 && strcmp(cmd, "remove") == 0) {
      APPBARDATA d = appbar_data(h);
      SHAppBarMessage(ABM_REMOVE, &d);
      if (bar == h) bar = 0;
      buf_str(&out, "1");
    }
    write_line(&out);
  }
  // 標準入力が閉じた（Bantus が終わった、落ちた）。登録したままのものを外してから終わる
  if (bar) {
    APPBARDATA d = appbar_data(bar);
    SHAppBarMessage(ABM_REMOVE, &d);
  }
}

int main(int argc, char **argv) {
  stdIn = GetStdHandle(STD_INPUT_HANDLE);
  stdOut = GetStdHandle(STD_OUTPUT_HANDLE);
  if (!stdIn || stdIn == INVALID_HANDLE_VALUE || !stdOut || stdOut == INVALID_HANDLE_VALUE) return 1;
  // 座標はどれも物理ピクセルで扱う（appbar.ts のスクリプトは呼ぶたびにスレッドを Per-Monitor v2 にしている）
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  // ウィンドウのあるプログラムとして起動すると、マウスの形が「起動中」になる。メッセージを 1 回受け取ったところで元に戻る
  MSG msg;
  PostThreadMessageW(GetCurrentThreadId(), WM_NULL, 0, 0);
  GetMessageW(&msg, NULL, 0, 0);
  if (argc > 1 && strcmp(argv[1], "appbar") == 0) run_appbar();
  else run_foreground();
  return 0;
}
