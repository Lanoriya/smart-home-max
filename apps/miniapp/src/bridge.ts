// A thin wrapper over MAX Bridge (window.WebApp). Every call is guarded: in a
// usual browser during development the bridge is missing, and in the web
// client of MAX some methods (sharing, haptics) are not supported.

type HapticStyle = 'light' | 'medium' | 'heavy' | 'soft' | 'rigid';
type NotificationKind = 'success' | 'warning' | 'error';

type WebApp = {
  initData?: string;
  initDataUnsafe?: { start_param?: string; user?: { id: number; first_name?: string } };
  platform?: 'ios' | 'android' | 'desktop' | 'web';
  ready?: () => void;
  close?: () => void;
  openLink?: (url: string) => void;
  requestContact?: () => Promise<unknown>;
  openMaxLink?: (url: string) => void;
  shareContent?: (params: { text?: string; link?: string }) => Promise<unknown> | void;
  shareMaxContent?: (params: { text?: string; link?: string }) => Promise<unknown> | void;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  BackButton?: { show: () => void; hide: () => void; onClick: (callback: () => void) => void; offClick: (callback: () => void) => void };
  HapticFeedback?: {
    impactOccurred?: (style: HapticStyle, disableVibrationFallback?: boolean) => void;
    notificationOccurred?: (kind: NotificationKind, disableVibrationFallback?: boolean) => void;
    selectionChanged?: () => void;
  };
};

declare global {
  interface Window {
    WebApp?: WebApp;
  }
}

const app = (): WebApp | undefined => window.WebApp;

function safely<T>(action: () => T): T | undefined {
  try {
    return action();
  } catch {
    return undefined;
  }
}

// Sign-in by a personal link from the bot (?t=…), used while the mini-app is
// not registered for the bot. The token is kept for this tab only and removed
// from the address bar so it does not end up in screenshots or shared links.
const linkTokenKey = 'domoved-link-token';
let linkToken: string | null = null;
export function readLinkToken(): string | null {
  if (linkToken) return linkToken;
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('t');
  if (fromUrl) {
    url.searchParams.delete('t');
    window.history.replaceState(null, '', url.toString());
  }
  try {
    if (fromUrl) sessionStorage.setItem(linkTokenKey, fromUrl);
    linkToken = fromUrl ?? sessionStorage.getItem(linkTokenKey);
  } catch {
    linkToken = fromUrl;
  }
  return linkToken;
}

// Development outside MAX: /app/?dev=1001 signs in as MAX user 1001 through the
// backend's development header. It works only when the backend allows it.
const devUserKey = 'domoved-dev-user';
export function devUserId(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get('dev');
  try {
    if (fromUrl) sessionStorage.setItem(devUserKey, fromUrl);
    return fromUrl ?? sessionStorage.getItem(devUserKey);
  } catch {
    return fromUrl;
  }
}

export const bridge = {
  get initData(): string {
    return app()?.initData ?? '';
  },
  get insideMax(): boolean {
    return Boolean(app()?.initData);
  },
  // Whether MAX shows its own back button for the app.
  get hasSystemBack(): boolean {
    return Boolean(app()?.initData && app()?.BackButton);
  },
  get platform(): 'ios' | 'android' {
    const platform = app()?.platform;
    if (platform === 'ios' || platform === 'android') return platform;
    return /iphone|ipad|mac os/i.test(navigator.userAgent) ? 'ios' : 'android';
  },
  get isMobile(): boolean {
    const platform = app()?.platform;
    return platform === 'ios' || platform === 'android';
  },
  // The parameter after ?startapp= of a link: "incident_42", "invite_…", "map".
  get startParam(): string | null {
    const fromBridge = app()?.initDataUnsafe?.start_param;
    if (fromBridge) return fromBridge;
    return new URLSearchParams(window.location.search).get('startapp');
  },
  ready() {
    safely(() => app()?.ready?.());
  },
  openLink(url: string) {
    if (app()?.openLink) safely(() => app()!.openLink!(url));
    else window.open(url, '_blank', 'noopener');
  },
  openMaxLink(url: string) {
    if (app()?.openMaxLink) safely(() => app()!.openMaxLink!(url));
    else window.open(url, '_blank', 'noopener');
  },
  // Inside MAX first; the system share sheet on phones; the clipboard otherwise.
  async share(text: string, link?: string): Promise<'shared' | 'copied' | 'failed'> {
    const params = link ? { text, link } : { text };
    try {
      if (app()?.shareMaxContent) { await app()!.shareMaxContent!(params); return 'shared'; }
      if (app()?.shareContent && bridge.isMobile) { await app()!.shareContent!(params); return 'shared'; }
    } catch {
      // Falls through to copying.
    }
    try {
      await navigator.clipboard.writeText(link ? `${text}\n${link}` : text);
      return 'copied';
    } catch {
      return 'failed';
    }
  },
  // Copying works in the webview of MAX too, where the Clipboard API may be
  // missing: then a hidden field is selected and copied.
  async copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      return copied;
    }
  },
  // MAX asks the person whether to share their number; null when there is
  // no MAX around (a browser) or the person declined.
  canRequestPhone: Boolean(app()?.requestContact),
  async requestPhone(): Promise<string | null> {
    try {
      const answer = await app()?.requestContact?.();
      const found = JSON.stringify(answer ?? '').match(/\+?\d[\d\s()-]{9,}\d/);
      return found ? found[0] : null;
    } catch {
      return null;
    }
  },
  backButton(callback: (() => void) | null) {
    const button = app()?.BackButton;
    if (!button) return () => undefined;
    if (!callback) { safely(() => button.hide()); return () => undefined; }
    safely(() => { button.onClick(callback); button.show(); });
    return () => safely(() => button.offClick(callback));
  },
  confirmClosing(enabled: boolean) {
    safely(() => (enabled ? app()?.enableClosingConfirmation?.() : app()?.disableClosingConfirmation?.()));
  },
  haptic(kind: NotificationKind | 'tap') {
    safely(() => {
      const feedback = app()?.HapticFeedback;
      if (kind === 'tap') feedback?.impactOccurred?.('light');
      else feedback?.notificationOccurred?.(kind);
    });
  },
};
