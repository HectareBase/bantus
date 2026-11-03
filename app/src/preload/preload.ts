// 画面に公開する API。Node や Electron の機能は、これ以外は画面から使えない。
// sandbox の preload は自分のファイル以外を読み込めないので、shared からは型だけを使う。

import { contextBridge, ipcRenderer } from 'electron';
import type { Settings } from '../shared/settings';
import type { SessionView, SettingsApi, WidgetApi, WidgetLayout } from '../shared/types';

const widget: WidgetApi = {
  onSessions: (listener) => {
    ipcRenderer.on('sessions', (_e, sessions: SessionView[]) => listener(sessions));
  },
  onLayout: (listener) => {
    ipcRenderer.on('layout', (_e, layout: WidgetLayout) => listener(layout));
  },
  getLayout: () => ipcRenderer.invoke('layout:get'),
  onCycle: (listener) => {
    ipcRenderer.on('cycle', () => listener());
  },
  openSession: (id) => ipcRenderer.send('open-session', id),
  setCollapsed: (collapsed) => ipcRenderer.send('set-collapsed', collapsed),
  setClickThrough: (through) => ipcRenderer.send('set-click-through', through),
  resizeStart: () => ipcRenderer.send('resize-start'),
  resizeMove: () => ipcRenderer.send('resize-move'),
  resizeEnd: () => ipcRenderer.send('resize-end'),
  openSettings: () => ipcRenderer.send('open-settings'),
  setPinned: (pinned) => ipcRenderer.send('set-pinned', pinned),
  setAlwaysShow: (id, on) => ipcRenderer.send('set-always-show', id, on),
};

const settingsApi: SettingsApi = {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (patch) => ipcRenderer.send('settings:set', patch),
  onChange: (listener) => {
    ipcRenderer.on('settings:changed', (_e, settings: Settings) => listener(settings));
  },
  displays: () => ipcRenderer.invoke('settings:displays'),
  about: () => ipcRenderer.invoke('settings:about'),
};

contextBridge.exposeInMainWorld('widget', widget);
contextBridge.exposeInMainWorld('settingsApi', settingsApi);
