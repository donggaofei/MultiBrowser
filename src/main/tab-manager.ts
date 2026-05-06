import {
  BrowserWindow,
  WebContentsView,
  session,
  shell,
  type Rectangle,
  type Session
} from 'electron';
import type { Account, NavState } from '../shared/types';

const CHROME_HEIGHT_FALLBACK = 88;

export class TabManager {
  private mainWindow: BrowserWindow;
  private views = new Map<string, WebContentsView>();
  private activeId: string | null = null;
  private chromeHeight = CHROME_HEIGHT_FALLBACK;
  private overlayVisible = true;
  private onNavStateChange: (id: string, state: NavState) => void;
  private chromeIdentityApplied = new WeakSet<Session>();

  constructor(
    mainWindow: BrowserWindow,
    onNavStateChange: (id: string, state: NavState) => void
  ) {
    this.mainWindow = mainWindow;
    this.onNavStateChange = onNavStateChange;
    this.mainWindow.on('resize', () => this.layoutActive());
    this.mainWindow.on('enter-full-screen', () => this.layoutActive());
    this.mainWindow.on('leave-full-screen', () => this.layoutActive());
  }

  setChromeHeight(height: number): void {
    if (Number.isFinite(height) && height > 0) {
      this.chromeHeight = Math.round(height);
      this.layoutActive();
    }
  }

  hasView(accountId: string): boolean {
    return this.views.has(accountId);
  }

  ensureView(account: Account): WebContentsView {
    const existing = this.views.get(account.id);
    if (existing) return existing;

    const partition = `persist:account-${account.id}`;
    const view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true
      }
    });

    this.applyChromeIdentity(view.webContents.session);
    this.attachWebContentsHandlers(account.id, view);
    this.views.set(account.id, view);
    void view.webContents.loadURL(account.url);
    return view;
  }

  private applyChromeIdentity(ses: Session): void {
    if (this.chromeIdentityApplied.has(ses)) return;
    this.chromeIdentityApplied.add(ses);

    // 去掉 UA 里的 MultiBrowser/x.y.z 与 Electron/x.y.z，伪装成纯 Chrome
    const cleanUa = ses
      .getUserAgent()
      .replace(/\s*MultiBrowser\/\S+/g, '')
      .replace(/\s*Electron\/\S+/g, '');
    ses.setUserAgent(cleanUa);

    // 同步改写 Sec-CH-UA 系列 client hints（HTTP 头）
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      for (const key of Object.keys(headers)) {
        const lk = key.toLowerCase();
        if (lk === 'sec-ch-ua' || lk === 'sec-ch-ua-full-version-list') {
          const value = headers[key];
          if (typeof value === 'string') {
            headers[key] = value
              .replace(/,?\s*"MultiBrowser";v="[^"]*"/g, '')
              .replace(/,?\s*"Electron";v="[^"]*"/g, '')
              .replace(/^,\s*/, '');
          }
        }
      }
      callback({ requestHeaders: headers });
    });
  }

  activate(accountId: string): void {
    const view = this.views.get(accountId);
    if (!view) return;

    if (this.activeId && this.activeId !== accountId) {
      const prev = this.views.get(this.activeId);
      if (prev) {
        try {
          this.mainWindow.contentView.removeChildView(prev);
        } catch {
          // ignore - view may already be detached
        }
      }
    }

    this.activeId = accountId;
    if (this.overlayVisible) {
      this.mainWindow.contentView.addChildView(view);
      this.layoutActive();
    }
    this.emitNavState(accountId);
  }

  setOverlayVisible(visible: boolean): void {
    if (this.overlayVisible === visible) return;
    this.overlayVisible = visible;
    if (!this.activeId) return;
    const view = this.views.get(this.activeId);
    if (!view) return;
    if (visible) {
      this.mainWindow.contentView.addChildView(view);
      this.layoutActive();
    } else {
      try {
        this.mainWindow.contentView.removeChildView(view);
      } catch {
        // ignore - view may already be detached
      }
    }
  }

  async destroy(accountId: string): Promise<void> {
    const view = this.views.get(accountId);
    if (view) {
      try {
        this.mainWindow.contentView.removeChildView(view);
      } catch {
        // ignore
      }
      const wc = view.webContents;
      if (!wc.isDestroyed()) {
        wc.close();
      }
      this.views.delete(accountId);
    }
    if (this.activeId === accountId) {
      this.activeId = null;
    }
    try {
      const partition = `persist:account-${accountId}`;
      await session.fromPartition(partition).clearStorageData();
    } catch (err) {
      console.error('[TabManager] clearStorageData failed:', err);
    }
  }

  navigate(accountId: string, url: string): void {
    const view = this.views.get(accountId);
    if (!view) return;
    void view.webContents.loadURL(this.normalizeUrl(url));
  }

  goBack(accountId: string): void {
    const wc = this.views.get(accountId)?.webContents;
    if (wc?.navigationHistory.canGoBack()) {
      wc.navigationHistory.goBack();
    }
  }

  goForward(accountId: string): void {
    const wc = this.views.get(accountId)?.webContents;
    if (wc?.navigationHistory.canGoForward()) {
      wc.navigationHistory.goForward();
    }
  }

  reload(accountId: string): void {
    const wc = this.views.get(accountId)?.webContents;
    wc?.reload();
  }

  stop(accountId: string): void {
    const wc = this.views.get(accountId)?.webContents;
    wc?.stop();
  }

  getNavState(accountId: string): NavState | null {
    const wc = this.views.get(accountId)?.webContents;
    if (!wc) return null;
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      isLoading: wc.isLoading()
    };
  }

  private emitNavState(accountId: string): void {
    const state = this.getNavState(accountId);
    if (state) this.onNavStateChange(accountId, state);
  }

  private layoutActive(): void {
    if (!this.activeId) return;
    const view = this.views.get(this.activeId);
    if (!view) return;
    const bounds = this.computeContentBounds();
    view.setBounds(bounds);
  }

  private computeContentBounds(): Rectangle {
    const [width, height] = this.mainWindow.getContentSize();
    const top = this.chromeHeight;
    return {
      x: 0,
      y: top,
      width: Math.max(0, width),
      height: Math.max(0, height - top)
    };
  }

  private static readonly INTERNAL_PROTOCOLS = new Set([
    'http:',
    'https:',
    'about:',
    'data:',
    'blob:',
    'file:',
    'chrome:',
    'devtools:'
  ]);

  private static readonly OS_PROTOCOLS = new Set(['mailto:', 'tel:']);

  private classifyUrl(url: string): 'internal' | 'os' | 'block' {
    try {
      const protocol = new URL(url).protocol;
      if (TabManager.INTERNAL_PROTOCOLS.has(protocol)) return 'internal';
      if (TabManager.OS_PROTOCOLS.has(protocol)) return 'os';
      return 'block';
    } catch {
      return 'block';
    }
  }

  private attachWebContentsHandlers(accountId: string, view: WebContentsView): void {
    const wc = view.webContents;

    wc.setWindowOpenHandler(({ url }) => {
      const kind = this.classifyUrl(url);
      if (kind === 'internal') {
        // target=_blank → 在当前账号 view 内打开，避免逃出隔离
        void wc.loadURL(url);
      } else if (kind === 'os') {
        void shell.openExternal(url);
      }
      // block: 静默拒绝（如 bytedance://、weixin:// 等无对应应用的自定义 scheme）
      return { action: 'deny' };
    });

    wc.on('will-navigate', (event, url) => {
      const kind = this.classifyUrl(url);
      if (kind === 'os') {
        event.preventDefault();
        void shell.openExternal(url);
      } else if (kind === 'block') {
        // 阻止 OS 弹"无对应应用"的对话框
        event.preventDefault();
      }
    });

    // 子 frame / iframe 也可能尝试触发自定义 scheme
    wc.on('will-frame-navigate', (event) => {
      if (this.classifyUrl(event.url) === 'block') {
        event.preventDefault();
      }
    });

    // 兜底：任何被路由到外部 handler 的请求也拦掉
    wc.on('will-redirect', (event, url) => {
      if (this.classifyUrl(url) === 'block') {
        event.preventDefault();
      }
    });

    const fire = (): void => this.emitNavState(accountId);
    wc.on('did-start-loading', fire);
    wc.on('did-stop-loading', fire);
    wc.on('did-navigate', fire);
    wc.on('did-navigate-in-page', fire);
    wc.on('page-title-updated', fire);
    wc.on('did-finish-load', fire);
  }

  private normalizeUrl(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return 'about:blank';
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
    if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(trimmed)) return `https://${trimmed}`;
    const q = encodeURIComponent(trimmed);
    return `https://www.bing.com/search?q=${q}`;
  }
}
