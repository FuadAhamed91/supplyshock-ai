// Minimal CDP driver for deterministic capture of the running app.
// Node 22 has a built-in WebSocket, so this needs no dependencies.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export async function launch({ port = 9333, width = 1280, height = 720, swiftshader = false, profile = 'cap' } = {}) {
  const userDir = path.join(os.tmpdir(), 'brag-chrome', profile);
  const flags = [
    '--headless=new', '--no-sandbox', '--hide-scrollbars', '--mute-audio',
    '--disable-extensions', '--disable-background-timer-throttling',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    `--window-size=${width},${height}`,
    '--force-device-scale-factor=1',
    `--user-data-dir=${userDir}`,
    'about:blank',
  ];
  if (swiftshader) flags.splice(1, 0, '--enable-unsafe-swiftshader', '--use-angle=swiftshader');
  const chrome = spawn(CHROME, flags, { stdio: 'ignore' });
  chrome.on('error', (e) => { console.error('chrome spawn failed:', e.message); });

  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* not up yet */ }
    if (!target) await sleep(250);
  }
  if (!target) { chrome.kill(); throw new Error('Chrome did not expose a debugging target'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let id = 0;
  const pending = new Map();
  const waiters = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.method + ' ' + JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method && waiters.has(msg.method)) {
      const fns = waiters.get(msg.method);
      waiters.set(msg.method, []);
      fns.forEach((fn) => fn(msg.params));
    }
  };

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const once = (method) => new Promise((resolve) => {
    if (!waiters.has(method)) waiters.set(method, []);
    waiters.get(method).push(resolve);
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
    return r.result.value;
  };
  const close = () => { try { ws.close(); } catch {} chrome.kill(); };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  return { send, once, evaluate, close, width, height };
}

/** Advance the page's clock by exactly one frame, deterministically. */
export async function stepFrame(cdp, ms) {
  const expired = cdp.once('Emulation.virtualTimeBudgetExpired');
  await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: ms });
  await expired;
}

export async function grab(cdp, quality = 92) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality, captureBeyondViewport: false });
  return Buffer.from(r.data, 'base64');
}
