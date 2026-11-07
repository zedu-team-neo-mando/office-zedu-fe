/**
 * The office running inside the Zedu Desktop app. Desktop loads the office in
 * a WebView (flutter_inappwebview) and answers on one JavaScript handler,
 * `zeduDesktop`:
 *
 * - `getZeduToken` returns `{ token, apiUrl }`: the desktop's zedu session and
 *   the zedu-be it belongs to, so the office signs in without a second login
 *   and reads channel rooms from zedu directly.
 * - `exit` closes the WebView and returns to the desktop app.
 *
 * In a browser the bridge is absent and every helper here falls back to the
 * web behaviour, so nothing changes for web users.
 */

const HANDLER = "zeduDesktop";
const EMBED_KEY = "office-desktop-embed";
const ZEDU_TOKEN_KEY = "zeduToken";
const ZEDU_API_KEY = "zeduApiUrl";
const ZEDU_CONNECT_KEY = "zeduConnectUrl";
const READY_EVENT = "flutterInAppWebViewPlatformReady";
const READY_TIMEOUT_MS = 4000;

type DesktopBridge = {
  callHandler: (name: string, ...args: unknown[]) => Promise<unknown>;
};

type DesktopWindow = Window & { flutter_inappwebview?: DesktopBridge };

/**
 * `connectUrl` is zedu-be's Centrifugo websocket. It comes from the office
 * backend at sign-in, not from desktop, and is empty when not configured.
 */
export type ZeduSession = {
  token: string;
  apiUrl: string;
  connectUrl?: string;
};

function desktopWindow(): DesktopWindow | null {
  return typeof window === "undefined" ? null : (window as DesktopWindow);
}

/** Marks this tab as embedded; it lasts for the WebView's session only. */
export function markDesktopEmbed(): void {
  try {
    sessionStorage.setItem(EMBED_KEY, "1");
  } catch {
    // Storage can be blocked; the bridge check below still works.
  }
}

/** True when the office is showing inside Zedu Desktop. */
export function isDesktopEmbed(): boolean {
  const w = desktopWindow();
  if (!w) return false;
  if (w.flutter_inappwebview) return true;
  try {
    return sessionStorage.getItem(EMBED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The bridge object is injected while the page loads, so it can be missing on
 * the first tick; wait for the platform's ready event, but not forever.
 */
function waitForBridge(): Promise<DesktopBridge | undefined> {
  const w = desktopWindow();
  if (!w) return Promise.resolve(undefined);
  if (w.flutter_inappwebview) return Promise.resolve(w.flutter_inappwebview);

  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      w.removeEventListener(READY_EVENT, done);
      resolve(w.flutter_inappwebview);
    };
    const timer = window.setTimeout(done, READY_TIMEOUT_MS);
    w.addEventListener(READY_EVENT, done);
  });
}

/** The desktop's zedu session, or null outside the desktop app. */
export async function requestZeduSession(): Promise<ZeduSession | null> {
  try {
    const bridge = await waitForBridge();
    if (!bridge) return null;
    const reply = (await bridge.callHandler(HANDLER, {
      type: "getZeduToken",
    })) as { token?: unknown; apiUrl?: unknown } | undefined;
    if (typeof reply?.token !== "string" || !reply.token) return null;
    if (typeof reply.apiUrl !== "string" || !reply.apiUrl) return null;
    return { token: reply.token, apiUrl: reply.apiUrl.replace(/\/+$/, "") };
  } catch {
    return null;
  }
}

/** Kept with the office session; cleared with it on sign-out. */
export function storeZeduSession(session: ZeduSession): void {
  localStorage.setItem(ZEDU_TOKEN_KEY, session.token);
  localStorage.setItem(ZEDU_API_KEY, session.apiUrl);
  localStorage.setItem(ZEDU_CONNECT_KEY, session.connectUrl ?? "");
}

/** The stored zedu session, only while the office is embedded. */
export function storedZeduSession(): ZeduSession | null {
  if (!isDesktopEmbed()) return null;
  try {
    const token = localStorage.getItem(ZEDU_TOKEN_KEY);
    const apiUrl = localStorage.getItem(ZEDU_API_KEY);
    const connectUrl = localStorage.getItem(ZEDU_CONNECT_KEY) ?? "";
    return token && apiUrl ? { token, apiUrl, connectUrl } : null;
  } catch {
    return null;
  }
}

/**
 * Asks the desktop to close the office. Returns false when there is no
 * desktop to ask, so the caller can leave the web way instead.
 */
export async function exitToDesktop(): Promise<boolean> {
  if (!isDesktopEmbed()) return false;
  try {
    const bridge = await waitForBridge();
    if (!bridge) return false;
    await bridge.callHandler(HANDLER, { type: "exit" });
    return true;
  } catch {
    return false;
  }
}
