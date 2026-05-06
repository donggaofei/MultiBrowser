import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { AccountStore } from './account-store';
import { TabManager } from './tab-manager';
import { registerIpc, makeNavStateForwarder } from './ipc';
import { applyDataDirOverride } from './data-dir';

applyDataDirOverride();

async function bootstrap(): Promise<void> {
  const store = new AccountStore();
  await store.load();

  const win = createMainWindow();
  const forwardNavState = makeNavStateForwarder(win);
  const tabs = new TabManager(win, forwardNavState);

  registerIpc(win, store, tabs);
}

app.whenReady().then(() => {
  void bootstrap();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void bootstrap();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
