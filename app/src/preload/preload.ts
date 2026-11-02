// 画面に公開する API。Node や Electron の機能は、これ以外は画面から使えない。

import { contextBridge, ipcRenderer } from 'electron';
import type { SessionView, WidgetApi } from '../shared/types';

const api: WidgetApi = {
  onSessions: (listener) => {
    ipcRenderer.on('sessions', (_e, sessions: SessionView[]) => listener(sessions));
  },
  openSession: (id) => ipcRenderer.send('open-session', id),
  setCollapsed: (collapsed) => ipcRenderer.send('set-collapsed', collapsed),
  quit: () => ipcRenderer.send('quit'),
};

contextBridge.exposeInMainWorld('widget', api);
