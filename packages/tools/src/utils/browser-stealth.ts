/// <reference lib="dom" />
import type { Page } from 'puppeteer';

// ─── Stealth Configuration ─────────────────────────────────────
// Comprehensive anti-detection measures inspired by Scrapling's StealthyFetcher.
// Applies multiple evasion layers to make headless Chrome indistinguishable from a real browser.

const STEALTH_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
];

const LANGUAGES = [
  ['pt-BR', 'pt', 'en-US', 'en'],
  ['en-US', 'en', 'pt-BR', 'pt'],
  ['en-US', 'en'],
];

const TIMEZONES = [
  'America/Sao_Paulo',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
];

const WEBGL_VENDORS = [
  'Google Inc. (NVIDIA)',
  'Google Inc. (Intel)',
  'Google Inc. (AMD)',
];

const WEBGL_RENDERERS = [
  'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export interface StealthProfile {
  userAgent: string;
  viewport: { width: number; height: number };
  languages: string[];
  timezone: string;
  webglVendor: string;
  webglRenderer: string;
}

export function generateStealthProfile(): StealthProfile {
  return {
    userAgent: randomItem(STEALTH_USER_AGENTS),
    viewport: randomItem(VIEWPORTS),
    languages: randomItem(LANGUAGES),
    timezone: randomItem(TIMEZONES),
    webglVendor: randomItem(WEBGL_VENDORS),
    webglRenderer: randomItem(WEBGL_RENDERERS),
  };
}

export function getStealthLaunchArgs(profile: StealthProfile): string[] {
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote',
    '--headless=new',
    // Anti-detection flags
    '--disable-blink-features=AutomationControlled',
    `--user-agent=${profile.userAgent}`,
    `--lang=${profile.languages[0]}`,
    `--window-size=${profile.viewport.width},${profile.viewport.height}`,
    // Fingerprint consistency
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-web-security=false',
    // Prevent WebRTC IP leak
    '--enforce-webrtc-ip-permission-check',
    '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  ];
}

export async function applyStealthEvasions(page: Page, profile: StealthProfile): Promise<void> {
  // ─── 1. navigator.webdriver removal ─────────────────
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
    // Remove webdriver from prototype chain
    // @ts-ignore
    delete Navigator.prototype.webdriver;
  });

  // ─── 2. Chrome runtime emulation ─────────────────
  await page.evaluateOnNewDocument(() => {
    // @ts-ignore
    window.chrome = {
      app: {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      },
      runtime: {
        OnInstalledReason: {
          CHROME_UPDATE: 'chrome_update',
          INSTALL: 'install',
          SHARED_MODULE_UPDATE: 'shared_module_update',
          UPDATE: 'update',
        },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        PlatformArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
        RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
        connect: () => {},
        sendMessage: () => {},
        id: undefined,
      },
      csi: () => ({}),
      loadTimes: () => ({
        commitLoadTime: Date.now() / 1000,
        connectionInfo: 'h2',
        finishDocumentLoadTime: Date.now() / 1000 + 0.1,
        finishLoadTime: Date.now() / 1000 + 0.3,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000 + 0.05,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: Date.now() / 1000 - 0.5,
        startLoadTime: Date.now() / 1000 - 0.4,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
      }),
    };
  });

  // ─── 3. Plugins & MimeTypes spoofing ─────────────────
  await page.evaluateOnNewDocument(() => {
    const mockPlugin = (name: string, description: string, filename: string) => ({
      name,
      description,
      filename,
      length: 1,
      0: { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      item: (i: number) => (i === 0 ? mockPlugin(name, description, filename)[0] : null),
      namedItem: (n: string) => (n === 'application/x-google-chrome-pdf' ? mockPlugin(name, description, filename)[0] : null),
      [Symbol.iterator]: function* () { yield mockPlugin(name, description, filename)[0]; },
    });

    const plugins = [
      mockPlugin('Chrome PDF Plugin', 'Portable Document Format', 'internal-pdf-viewer'),
      mockPlugin('Chrome PDF Viewer', '', 'mhjfbmdgcfjbbpaeojofohoefgiehjai'),
      mockPlugin('Native Client', '', 'internal-nacl-plugin'),
      mockPlugin('Chromium PDF Plugin', 'Portable Document Format', 'internal-pdf-viewer'),
      mockPlugin('Chromium PDF Viewer', '', 'mhjfbmdgcfjbbpaeojofohoefgiehjai'),
    ];

    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr: any = plugins;
        arr.item = (i: number) => plugins[i] || null;
        arr.namedItem = (name: string) => plugins.find((p: any) => p.name === name) || null;
        arr.refresh = () => {};
        return arr;
      },
    });

    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => {
        const mimes = [{
          type: 'application/pdf',
          suffixes: 'pdf',
          description: 'Portable Document Format',
          enabledPlugin: plugins[0],
        }];
        const arr: any = mimes;
        arr.item = (i: number) => mimes[i] || null;
        arr.namedItem = (name: string) => mimes.find((m: any) => m.type === name) || null;
        return arr;
      },
    });
  });

  // ─── 4. Languages ─────────────────
  const langs = profile.languages;
  await page.evaluateOnNewDocument((languages: string[]) => {
    Object.defineProperty(navigator, 'languages', {
      get: () => Object.freeze([...languages]),
    });
    Object.defineProperty(navigator, 'language', {
      get: () => languages[0],
    });
  }, langs);

  // ─── 5. Permissions API override ─────────────────
  await page.evaluateOnNewDocument(() => {
    const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
    if (originalQuery) {
      // @ts-ignore
      window.navigator.permissions.query = (parameters: any) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission, onchange: null } as PermissionStatus);
        }
        return originalQuery(parameters).catch(() =>
          Promise.resolve({ state: 'prompt', onchange: null } as PermissionStatus)
        );
      };
    }
  });

  // ─── 6. iframe contentWindow patching ─────────────────
  await page.evaluateOnNewDocument(() => {
    // Patch HTMLIFrameElement to return proper contentWindow
    const origDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    if (origDescriptor) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: function () {
          const win = origDescriptor.get?.call(this);
          if (win) {
            try {
              // Make sure contentWindow.chrome exists
              if (!win.chrome) {
                win.chrome = (window as any).chrome;
              }
            } catch { /* cross-origin iframe, ignore */ }
          }
          return win;
        },
      });
    }
  });

  // ─── 7. Canvas fingerprint noise ─────────────────
  await page.evaluateOnNewDocument(() => {
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;

    // Add subtle noise to canvas operations
    const addNoise = (imageData: ImageData): ImageData => {
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        // Very subtle noise: ±1 on each channel
        data[i] = Math.max(0, Math.min(255, data[i] + (Math.random() > 0.5 ? 1 : -1)));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + (Math.random() > 0.5 ? 1 : -1)));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + (Math.random() > 0.5 ? 1 : -1)));
      }
      return imageData;
    };

    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      try {
        const ctx = this.getContext('2d');
        if (ctx) {
          const imageData = origGetImageData.call(ctx, 0, 0, this.width, this.height);
          ctx.putImageData(addNoise(imageData), 0, 0);
        }
      } catch { /* WebGL canvas, skip */ }
      return origToBlob.call(this, callback, type, quality);
    };

    HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
      try {
        const ctx = this.getContext('2d');
        if (ctx) {
          const imageData = origGetImageData.call(ctx, 0, 0, this.width, this.height);
          ctx.putImageData(addNoise(imageData), 0, 0);
        }
      } catch { /* WebGL canvas, skip */ }
      return origToDataURL.call(this, type, quality);
    };
  });

  // ─── 8. WebGL vendor/renderer spoofing ─────────────────
  const vendor = profile.webglVendor;
  const renderer = profile.webglRenderer;
  await page.evaluateOnNewDocument((glVendor: string, glRenderer: string) => {
    const getParameterProxy = new Proxy(WebGLRenderingContext.prototype.getParameter, {
      apply(target, thisArg, args) {
        const param = args[0];
        // UNMASKED_VENDOR_WEBGL
        if (param === 0x9245) return glVendor;
        // UNMASKED_RENDERER_WEBGL
        if (param === 0x9246) return glRenderer;
        return Reflect.apply(target, thisArg, args);
      },
    });
    WebGLRenderingContext.prototype.getParameter = getParameterProxy;

    // Also patch WebGL2 if available
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const getParameter2Proxy = new Proxy(WebGL2RenderingContext.prototype.getParameter, {
        apply(target, thisArg, args) {
          const param = args[0];
          if (param === 0x9245) return glVendor;
          if (param === 0x9246) return glRenderer;
          return Reflect.apply(target, thisArg, args);
        },
      });
      WebGL2RenderingContext.prototype.getParameter = getParameter2Proxy;
    }
  }, vendor, renderer);

  // ─── 9. Screen dimensions consistency ─────────────────
  const vp = profile.viewport;
  await page.evaluateOnNewDocument((width: number, height: number) => {
    Object.defineProperty(screen, 'width', { get: () => width });
    Object.defineProperty(screen, 'height', { get: () => height });
    Object.defineProperty(screen, 'availWidth', { get: () => width });
    Object.defineProperty(screen, 'availHeight', { get: () => height - 40 });
    Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
    Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
  }, vp.width, vp.height);

  // ─── 10. CDP detection prevention ─────────────────
  await page.evaluateOnNewDocument(() => {
    // Hide that we're using CDP
    // @ts-ignore
    window.cdc_adoQpoasnfa76pfcZLmcfl_Array = undefined;
    // @ts-ignore
    window.cdc_adoQpoasnfa76pfcZLmcfl_Promise = undefined;
    // @ts-ignore
    window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol = undefined;

    // Remove Puppeteer/CDP artifacts from window
    const keysToRemove = Object.keys(window).filter(key =>
      key.startsWith('cdc_') || key.startsWith('__puppeteer')
    );
    for (const key of keysToRemove) {
      try { delete (window as any)[key]; } catch {}
    }
  });

  // ─── 11. Connection/hardware consistency ─────────────────
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
    // @ts-ignore
    if (navigator.connection) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          rtt: 50,
          downlink: 10,
          saveData: false,
        }),
      });
    }
  });

  // ─── Apply page-level settings ─────────────────
  await page.setUserAgent(profile.userAgent);
  await page.setExtraHTTPHeaders({
    'Accept-Language': profile.languages.join(',') + ';q=0.9',
  });
  await page.setViewport({
    width: profile.viewport.width,
    height: profile.viewport.height,
    deviceScaleFactor: 1,
    hasTouch: false,
    isLandscape: true,
    isMobile: false,
  });
}

// ─── Referer spoofing (Google search origin) ─────────────────
export function getGoogleSearchReferer(url: string): string {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./, '');
    return `https://www.google.com/search?q=${encodeURIComponent(domain)}`;
  } catch {
    return 'https://www.google.com/';
  }
}
