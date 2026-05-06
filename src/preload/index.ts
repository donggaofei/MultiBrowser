import { contextBridge, ipcRenderer } from 'electron';
import type { Account, NavState } from '../shared/types';

const api = {
  listAccounts: (): Promise<Account[]> => ipcRenderer.invoke('accounts:list'),
  addAccount: (name: string, url?: string): Promise<Account> =>
    ipcRenderer.invoke('accounts:add', name, url),
  renameAccount: (id: string, name: string): Promise<Account | null> =>
    ipcRenderer.invoke('accounts:rename', id, name),
  removeAccount: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('accounts:remove', id),

  activateTab: (id: string): Promise<NavState | null> =>
    ipcRenderer.invoke('tab:activate', id),
  navigate: (id: string, url: string): Promise<void> =>
    ipcRenderer.invoke('tab:navigate', id, url),
  goBack: (id: string): Promise<void> => ipcRenderer.invoke('tab:back', id),
  goForward: (id: string): Promise<void> => ipcRenderer.invoke('tab:forward', id),
  reload: (id: string): Promise<void> => ipcRenderer.invoke('tab:reload', id),
  stop: (id: string): Promise<void> => ipcRenderer.invoke('tab:stop', id),
  getTabState: (id: string): Promise<NavState | null> =>
    ipcRenderer.invoke('tab:state', id),

  setChromeHeight: (height: number): Promise<void> =>
    ipcRenderer.invoke('chrome:setHeight', height),
  setOverlayVisible: (visible: boolean): Promise<void> =>
    ipcRenderer.invoke('chrome:setOverlayVisible', visible),

  openDataDirSettings: (): Promise<void> =>
    ipcRenderer.invoke('data-dir:openSettings'),

  onAccountsChanged: (handler: (accounts: Account[]) => void): (() => void) => {
    const listener = (_event: unknown, accounts: Account[]): void => handler(accounts);
    ipcRenderer.on('accounts:changed', listener);
    return () => ipcRenderer.removeListener('accounts:changed', listener);
  },
  onTabStateChanged: (
    handler: (id: string, state: NavState) => void
  ): (() => void) => {
    const listener = (_event: unknown, id: string, state: NavState): void =>
      handler(id, state);
    ipcRenderer.on('tab:state-changed', listener);
    return () => ipcRenderer.removeListener('tab:state-changed', listener);
  }
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
