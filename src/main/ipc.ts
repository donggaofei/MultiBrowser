import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import type { AccountStore } from './account-store';
import type { TabManager } from './tab-manager';
import type { NavState } from '../shared/types';
import {
  getCurrentDataDir,
  getDefaultDataDir,
  scheduleSwitch,
  validateNewDataDir
} from './data-dir';

export function registerIpc(
  win: BrowserWindow,
  store: AccountStore,
  tabs: TabManager
): void {
  const broadcastAccounts = (): void => {
    if (!win.isDestroyed()) {
      win.webContents.send('accounts:changed', store.list());
    }
  };

  ipcMain.handle('accounts:list', () => store.list());

  ipcMain.handle('accounts:add', async (_event, name: string, url?: string) => {
    const account = await store.add(name, url);
    broadcastAccounts();
    return account;
  });

  ipcMain.handle('accounts:rename', async (_event, id: string, name: string) => {
    const account = await store.rename(id, name);
    broadcastAccounts();
    return account ?? null;
  });

  ipcMain.handle('accounts:remove', async (_event, id: string) => {
    const ok = await store.remove(id);
    if (ok) {
      await tabs.destroy(id);
      broadcastAccounts();
    }
    return ok;
  });

  ipcMain.handle('tab:activate', (_event, id: string) => {
    const account = store.get(id);
    if (!account) return null;
    tabs.ensureView(account);
    tabs.activate(id);
    return tabs.getNavState(id);
  });

  ipcMain.handle('tab:navigate', (_event, id: string, url: string) => {
    tabs.navigate(id, url);
  });

  ipcMain.handle('tab:back', (_event, id: string) => tabs.goBack(id));
  ipcMain.handle('tab:forward', (_event, id: string) => tabs.goForward(id));
  ipcMain.handle('tab:reload', (_event, id: string) => tabs.reload(id));
  ipcMain.handle('tab:stop', (_event, id: string) => tabs.stop(id));
  ipcMain.handle('tab:state', (_event, id: string) => tabs.getNavState(id));

  ipcMain.handle('chrome:setHeight', (_event, height: number) => {
    tabs.setChromeHeight(height);
  });

  ipcMain.handle('chrome:setOverlayVisible', (_event, visible: boolean) => {
    tabs.setOverlayVisible(visible);
  });

  ipcMain.handle('data-dir:openSettings', async () => {
    await openDataDirSettings(win);
  });
}

async function openDataDirSettings(win: BrowserWindow): Promise<void> {
  const current = getCurrentDataDir();
  const defaultDir = getDefaultDataDir();
  const isCustom = current !== defaultDir;

  const buttons = isCustom
    ? ['取消', '选择新位置…', '在 Finder 中显示当前目录', '恢复默认位置']
    : ['取消', '选择新位置…', '在 Finder 中显示当前目录'];

  const choice = await dialog.showMessageBox(win, {
    type: 'info',
    title: '账号数据存放位置',
    message: '账号数据存放位置',
    detail:
      `当前位置：\n${current}\n\n` +
      (isCustom ? `默认位置：\n${defaultDir}\n\n` : '') +
      '该位置存放 accounts.json（账号元数据）以及每个账号的会话/Cookie/缓存。\n' +
      '切换位置需要重启应用。',
    buttons,
    cancelId: 0,
    defaultId: 1,
    noLink: true
  });

  if (choice.response === 0) return;

  if (buttons[choice.response] === '在 Finder 中显示当前目录') {
    shell.openPath(current).then((err) => {
      if (err) console.error('[data-dir] openPath failed:', err);
    });
    return;
  }

  if (buttons[choice.response] === '恢复默认位置') {
    await applySwitch(win, null, current, defaultDir);
    return;
  }

  // 选择新位置
  const picked = await dialog.showOpenDialog(win, {
    title: '选择新的账号数据目录',
    properties: ['openDirectory', 'createDirectory', 'showHiddenFiles'],
    buttonLabel: '选择此目录'
  });

  if (picked.canceled || picked.filePaths.length === 0) return;
  const newDir = picked.filePaths[0]!;

  const error = validateNewDataDir(newDir);
  if (error) {
    await dialog.showMessageBox(win, {
      type: 'error',
      title: '无法使用所选目录',
      message: error,
      buttons: ['好']
    });
    return;
  }

  await applySwitch(win, newDir, current, newDir);
}

async function applySwitch(
  win: BrowserWindow,
  newDir: string | null,
  fromDir: string,
  effectiveTarget: string
): Promise<void> {
  const migrateChoice = await dialog.showMessageBox(win, {
    type: 'question',
    title: '是否迁移现有数据？',
    message: '是否把当前目录的账号和登录态复制到新位置？',
    detail:
      `从：\n${fromDir}\n\n到：\n${effectiveTarget}\n\n` +
      '选择"迁移"会在重启后自动复制 accounts.json 与 Partitions 目录。\n' +
      '选择"不迁移"则新位置从空开始（旧数据保留在原位置不动）。',
    buttons: ['取消', '不迁移', '迁移'],
    cancelId: 0,
    defaultId: 2,
    noLink: true
  });

  if (migrateChoice.response === 0) return;
  const migrate = migrateChoice.response === 2;

  scheduleSwitch(newDir, migrate);

  const confirmRestart = await dialog.showMessageBox(win, {
    type: 'info',
    title: '需要重启',
    message: '设置已保存，重启后生效。',
    detail: migrate
      ? '重启时会自动迁移数据，目录较大时可能需要数十秒，期间窗口暂不显示属正常现象。'
      : '重启后将使用新的空目录。',
    buttons: ['稍后重启', '立即重启'],
    cancelId: 0,
    defaultId: 1,
    noLink: true
  });

  if (confirmRestart.response === 1) {
    app.relaunch();
    app.exit(0);
  }
}

export function makeNavStateForwarder(win: BrowserWindow) {
  return (id: string, state: NavState): void => {
    if (!win.isDestroyed()) {
      win.webContents.send('tab:state-changed', id, state);
    }
  };
}
