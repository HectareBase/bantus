// 画面に公開する API。Node や Electron の機能は、これ以外は画面から使えない。
// sandbox の preload は自分のファイル以外を読み込めないので、shared からは型だけを使う。

import { contextBridge, ipcRenderer } from 'electron';
import type { ActiveHighlight, Settings, StatusColors } from '../shared/settings';
import type { FetchStatus, FlyAction, FlyContent, FlyShow, FlyoutApi, SessionView, SettingsApi, SystemUsage, TipApi, ViewerState, WidgetApi, WidgetLayout } from '../shared/types';

const widget: WidgetApi = {
  onSessions: (listener) => {
    ipcRenderer.on('sessions', (_e, sessions: SessionView[]) => listener(sessions));
  },
  onLayout: (listener) => {
    ipcRenderer.on('layout', (_e, layout: WidgetLayout) => listener(layout));
  },
  getLayout: () => ipcRenderer.invoke('layout:get'),
  onCycle: (listener) => {
    ipcRenderer.on('cycle', (_e, claudeInFront: unknown) => listener(claudeInFront !== false));
  },
  openSession: (id) => ipcRenderer.send('open-session', id),
  raiseSession: (id) => ipcRenderer.send('raise-session', id),
  setClickThrough: (through) => ipcRenderer.send('set-click-through', through),
  resizeStart: () => ipcRenderer.send('resize-start'),
  resizeMove: () => ipcRenderer.send('resize-move'),
  resizeEnd: () => ipcRenderer.send('resize-end'),
  openSettings: () => ipcRenderer.send('open-settings'),
  setPinned: (pinned) => ipcRenderer.send('set-pinned', pinned),
  setArchive: (id, mark) => ipcRenderer.send('set-archive', id, mark),
  setCardArchive: (key, mark) => ipcRenderer.send('set-card-archive', key, mark),
  setHold: (id, mark) => ipcRenderer.send('set-hold', id, mark),
  setCardHold: (key, mark) => ipcRenderer.send('set-card-hold', key, mark),
  showFlyout: (request) => ipcRenderer.send('fly-show', request),
  updateFlyout: (key, content, count) => ipcRenderer.send('fly-update', key, content, count),
  leaveFlyout: (key) => ipcRenderer.send('fly-leave', key),
  setFlyTargets: (targets) => ipcRenderer.send('fly-targets', targets),
  onFlyHover: (listener) => {
    ipcRenderer.on('fly-hover', (_e, key: string) => listener(key));
  },
  onFlyAction: (listener) => {
    ipcRenderer.on('fly-action', (_e, action: FlyAction) => listener(action));
  },
  onFlyState: (listener) => {
    ipcRenderer.on('fly-state', (_e, key: string | undefined, open: boolean) => listener(key, open === true));
  },
  flashTaskbar: () => ipcRenderer.send('flash-taskbar'),
  isClaudeInFront: () => ipcRenderer.invoke('claude-in-front'),
  showToast: (toast) => ipcRenderer.send('show-toast', toast),
  onToastClick: (listener) => {
    ipcRenderer.on('toast-click', (_e, id: string) => listener(id));
  },
  showTip: (text, rect) => ipcRenderer.send('tip-show', text, rect),
  hideTip: () => ipcRenderer.send('tip-hide'),
  setFetchCards: (keys) => ipcRenderer.send('fetch-cards', keys),
  showCardMenu: (key) => ipcRenderer.send('card-menu', key),
  showSessionMenu: (id) => ipcRenderer.send('session-menu', id),
  showTitleMenu: () => ipcRenderer.send('title-menu'),
  setViewerTarget: (id) => ipcRenderer.send('viewer-target', id ?? null),
  setViewerBounds: (rect) => ipcRenderer.send('viewer-bounds', rect ?? null),
  reloadViewer: () => ipcRenderer.send('viewer-reload'),
  openViewerExternal: () => ipcRenderer.send('viewer-open-external'),
  setViewerLayout: (patch) => ipcRenderer.send('viewer-layout', patch),
  onViewerState: (listener) => {
    ipcRenderer.on('viewer:state', (_e, state: ViewerState) => listener(state));
  },
  onSystemUsage: (listener) => {
    ipcRenderer.on('system-usage', (_e, usage: SystemUsage) => listener(usage));
  },
};

const tipApi: TipApi = {
  onText: (listener) => {
    ipcRenderer.on('tip:text', (_e, text: string) => listener(text));
  },
  onVisible: (listener) => {
    ipcRenderer.on('tip:visible', (_e, visible: boolean) => listener(visible));
  },
  reportSize: (width, height) => ipcRenderer.send('tip:size', width, height),
};

const flyoutApi: FlyoutApi = {
  onShow: (listener) => {
    ipcRenderer.on('fly:show', (_e, show: FlyShow) => listener(show));
  },
  onContent: (listener) => {
    ipcRenderer.on('fly:content', (_e, content: FlyContent, count: number) => listener(content, count));
  },
  onOpen: (listener) => {
    ipcRenderer.on('fly:open', () => listener());
  },
  onHide: (listener) => {
    ipcRenderer.on('fly:hide', () => listener());
  },
  reportSolid: (rects) => ipcRenderer.send('fly:solid', rects),
  onColors: (listener) => {
    ipcRenderer.on('fly:colors', (_e, colors: StatusColors, highlight: ActiveHighlight) => listener(colors, highlight));
  },
  requestOpen: () => ipcRenderer.send('fly:request-open'),
  action: (action) => ipcRenderer.send('fly:action', action),
  showSessionMenu: (id) => ipcRenderer.send('session-menu', id),
  close: () => ipcRenderer.send('fly:close'),
};

const settingsApi: SettingsApi = {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (patch) => ipcRenderer.send('settings:set', patch),
  onChange: (listener) => {
    ipcRenderer.on('settings:changed', (_e, settings: Settings) => listener(settings));
  },
  displays: () => ipcRenderer.invoke('settings:displays'),
  about: () => ipcRenderer.invoke('settings:about'),
  runAction: (id) => ipcRenderer.send('settings:action', id),
  fetchStatus: () => ipcRenderer.invoke('fetch:status'),
  onFetchStatus: (listener) => {
    ipcRenderer.on('fetch:status', (_e, status: FetchStatus) => listener(status));
  },
};

contextBridge.exposeInMainWorld('widget', widget);
contextBridge.exposeInMainWorld('settingsApi', settingsApi);
contextBridge.exposeInMainWorld('tipApi', tipApi);
contextBridge.exposeInMainWorld('flyoutApi', flyoutApi);
