import type { Account, NavState } from '../shared/types';
import { DEFAULT_URL } from '../shared/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
};

const tabsEl = $('tabs');
const addTabBtn = $<HTMLButtonElement>('add-tab');
const emptyState = $('empty-state');
const emptyAddBtn = $<HTMLButtonElement>('empty-add');
const backBtn = $<HTMLButtonElement>('back');
const forwardBtn = $<HTMLButtonElement>('forward');
const reloadBtn = $<HTMLButtonElement>('reload');
const urlInput = $<HTMLInputElement>('url');
const loadingIndicator = $('loading-indicator');
const settingsBtn = $<HTMLButtonElement>('settings');
const dialog = $<HTMLDialogElement>('account-dialog');
const dialogTitle = $('dialog-title');
const dialogName = $<HTMLInputElement>('dialog-name');
const dialogUrl = $<HTMLInputElement>('dialog-url');
const chromeEl = $('chrome');

let accounts: Account[] = [];
let activeId: string | null = null;
let dialogMode: { type: 'create' } | { type: 'rename'; id: string } | null = null;

function reportChromeHeight(): void {
  void window.api.setChromeHeight(chromeEl.getBoundingClientRect().height);
}

function setEmptyVisible(visible: boolean): void {
  emptyState.hidden = !visible;
  // 地址栏在没有 Tab 时禁用
  const disabled = !visible ? false : true;
  backBtn.disabled = disabled;
  forwardBtn.disabled = disabled;
  reloadBtn.disabled = disabled;
  urlInput.disabled = disabled;
}

function renderTabs(): void {
  tabsEl.innerHTML = '';
  for (const account of accounts) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (account.id === activeId ? ' active' : '');
    tab.dataset['id'] = account.id;
    tab.title = account.name;

    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = account.name;
    tab.appendChild(name);

    tab.addEventListener('click', () => {
      void activateTab(account.id);
    });
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(account.id, e.clientX, e.clientY);
    });
    tabsEl.appendChild(tab);
  }
  setEmptyVisible(accounts.length === 0);
}

function applyNavState(state: NavState | null): void {
  if (!state) {
    urlInput.value = '';
    backBtn.disabled = true;
    forwardBtn.disabled = true;
    loadingIndicator.hidden = true;
    return;
  }
  if (document.activeElement !== urlInput) {
    urlInput.value = state.url;
  }
  backBtn.disabled = !state.canGoBack;
  forwardBtn.disabled = !state.canGoForward;
  reloadBtn.disabled = false;
  urlInput.disabled = false;
  loadingIndicator.hidden = !state.isLoading;
  if (state.title) document.title = `${state.title} · MultiBrowser`;
  // 给 tab 加 spinner
  const tab = tabsEl.querySelector<HTMLElement>(`.tab[data-id="${activeId}"]`);
  if (tab) {
    let spinner = tab.querySelector<HTMLElement>('.tab-spinner');
    if (state.isLoading && !spinner) {
      spinner = document.createElement('span');
      spinner.className = 'tab-spinner';
      tab.appendChild(spinner);
    } else if (!state.isLoading && spinner) {
      spinner.remove();
    }
  }
}

async function activateTab(id: string): Promise<void> {
  activeId = id;
  renderTabs();
  const state = await window.api.activateTab(id);
  applyNavState(state);
}

async function refreshAccounts(): Promise<void> {
  accounts = await window.api.listAccounts();
  if (activeId && !accounts.find((a) => a.id === activeId)) {
    activeId = null;
  }
  if (!activeId && accounts.length > 0) {
    await activateTab(accounts[0]!.id);
  } else {
    renderTabs();
    if (!activeId) applyNavState(null);
  }
}

function openCreateDialog(): void {
  dialogMode = { type: 'create' };
  dialogTitle.textContent = '新建账号';
  dialogName.value = `账号 ${accounts.length + 1}`;
  dialogUrl.value = DEFAULT_URL;
  void window.api.setOverlayVisible(false);
  dialog.showModal();
  dialogName.select();
}

function openRenameDialog(id: string): void {
  const account = accounts.find((a) => a.id === id);
  if (!account) return;
  dialogMode = { type: 'rename', id };
  dialogTitle.textContent = '重命名账号';
  dialogName.value = account.name;
  dialogUrl.value = account.url;
  dialogUrl.disabled = true;
  void window.api.setOverlayVisible(false);
  dialog.showModal();
  dialogName.select();
}

dialog.addEventListener('close', () => {
  void window.api.setOverlayVisible(true);
  dialogUrl.disabled = false;
  if (dialog.returnValue !== 'ok' || !dialogMode) {
    dialogMode = null;
    return;
  }
  const name = dialogName.value.trim();
  if (!name) {
    dialogMode = null;
    return;
  }
  const mode = dialogMode;
  dialogMode = null;
  if (mode.type === 'create') {
    const url = dialogUrl.value.trim() || DEFAULT_URL;
    void window.api.addAccount(name, url).then(async (account) => {
      await refreshAccounts();
      await activateTab(account.id);
    });
  } else {
    void window.api.renameAccount(mode.id, name).then(() => refreshAccounts());
  }
});

addTabBtn.addEventListener('click', openCreateDialog);
emptyAddBtn.addEventListener('click', openCreateDialog);

backBtn.addEventListener('click', () => {
  if (activeId) void window.api.goBack(activeId);
});
forwardBtn.addEventListener('click', () => {
  if (activeId) void window.api.goForward(activeId);
});
reloadBtn.addEventListener('click', () => {
  if (activeId) void window.api.reload(activeId);
});
settingsBtn.addEventListener('click', () => {
  void window.api.openDataDirSettings();
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && activeId) {
    void window.api.navigate(activeId, urlInput.value);
    urlInput.blur();
  } else if (e.key === 'Escape') {
    urlInput.blur();
  }
});

// 上下文菜单
let ctxMenu: HTMLElement | null = null;
function hideContextMenu(): void {
  ctxMenu?.remove();
  ctxMenu = null;
}
function showContextMenu(id: string, x: number, y: number): void {
  hideContextMenu();
  const menu = document.createElement('div');
  menu.id = 'tab-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const renameItem = document.createElement('div');
  renameItem.className = 'menu-item';
  renameItem.textContent = '重命名';
  renameItem.addEventListener('click', () => {
    hideContextMenu();
    openRenameDialog(id);
  });

  const deleteItem = document.createElement('div');
  deleteItem.className = 'menu-item danger';
  deleteItem.textContent = '删除（清除该账号所有数据）';
  deleteItem.addEventListener('click', () => {
    hideContextMenu();
    const account = accounts.find((a) => a.id === id);
    if (!account) return;
    if (!confirm(`确定删除「${account.name}」？该账号的登录态和缓存将被永久清除。`)) {
      return;
    }
    void window.api.removeAccount(id);
  });

  menu.appendChild(renameItem);
  menu.appendChild(deleteItem);
  document.body.appendChild(menu);
  ctxMenu = menu;
}
document.addEventListener('click', hideContextMenu);
document.addEventListener('contextmenu', (e) => {
  if (!(e.target as HTMLElement).closest('.tab')) hideContextMenu();
});

// 监听主进程推送
window.api.onAccountsChanged((updated) => {
  accounts = updated;
  if (activeId && !accounts.find((a) => a.id === activeId)) {
    activeId = null;
  }
  renderTabs();
  if (!activeId) applyNavState(null);
});

window.api.onTabStateChanged((id, state) => {
  if (id === activeId) applyNavState(state);
  else {
    // 后台 Tab 也维护 spinner
    const tab = tabsEl.querySelector<HTMLElement>(`.tab[data-id="${id}"]`);
    if (!tab) return;
    let spinner = tab.querySelector<HTMLElement>('.tab-spinner');
    if (state.isLoading && !spinner) {
      spinner = document.createElement('span');
      spinner.className = 'tab-spinner';
      tab.appendChild(spinner);
    } else if (!state.isLoading && spinner) {
      spinner.remove();
    }
  }
});

window.addEventListener('resize', reportChromeHeight);

// 启动
void (async () => {
  reportChromeHeight();
  await refreshAccounts();
})();
