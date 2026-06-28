// Capture README showcase screenshots by driving the running dev server with
// system Chrome over the DevTools Protocol. Zero npm dependencies — uses Node's
// built-in fetch + WebSocket (Node >= 22) and the Chrome you already have.
//
// Prereqs: the dev server must be running (npm run dev, default http://localhost:3000).
// Usage:   node scripts/capture-screenshots.mjs
// Env:     APP_URL (default http://localhost:3000), LOCALE (default en-US),
//          CHROME_BIN (default macOS Google Chrome path).
//
// Output:  docs/screenshots/*.png

import { writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';

const CHROME =
  process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP = process.env.APP_URL || 'http://localhost:3000';
const LOCALE = process.env.LOCALE || 'en-US';
const PORT = 9333;
const W = 1320,
  H = 880,
  SCALE = 2;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');

// Safely embed a string as a JavaScript literal inside source we build for
// Runtime.evaluate. JSON.stringify alone leaves '<', '>', '/' and the U+2028 /
// U+2029 line separators intact, any of which can break out of the surrounding
// code, so escape each one to its \uXXXX form.
const UNSAFE_JS_CHARS = new RegExp('[<>/' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
const jsString = (value) =>
  JSON.stringify(value).replace(
    UNSAFE_JS_CHARS,
    (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()
  );

// ── tiny CDP client over a WebSocket ───────────────────────────────────────
function makeCDP(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { ws, ready, send };
}

async function debuggerWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('Chrome remote-debugging endpoint never came up');
}

async function main() {
  // Fail fast if the dev server isn't running.
  try {
    await fetch(APP);
  } catch {
    throw new Error(`Dev server not reachable at ${APP} — start it first (npm run dev).`);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const userDataDir = join(os.tmpdir(), `qa-shots-${process.pid}`);
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      `--window-size=${W},${H}`,
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-gpu',
    ],
    { stdio: 'ignore' }
  );

  const cdp = makeCDP(await debuggerWsUrl());
  await cdp.ready;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (method, params) => cdp.send(method, params, sessionId);

  await S('Page.enable');
  await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: SCALE,
    mobile: false,
  });
  // Pin the UI language before any app script runs.
  await S('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('qa_locale', ${jsString(LOCALE)}); } catch (e) {}`,
  });

  const evalJs = async (expression, awaitPromise = false) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'eval error'
      );
    }
    return r.result.value;
  };
  const waitFor = async (cond, timeout = 20000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await evalJs(`!!(${cond})`)) return;
      await sleep(150);
    }
    throw new Error('waitFor timed out: ' + cond);
  };
  const click = async (selector) => {
    const ok = await evalJs(
      `(()=>{const el=document.querySelector(${jsString(selector)}); if(!el) return false; el.click(); return true;})()`
    );
    if (!ok) throw new Error('element not found: ' + selector);
  };
  const nav = (label) => click(`button.qa-rail-btn[aria-label=${JSON.stringify(label)}]`);
  const shot = async (name) => {
    const { data } = await S('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
    console.log('  saved', `${name}.png`);
  };
  const scene = async (name, fn) => {
    try {
      if (fn) await fn();
      await sleep(450);
      await shot(name);
    } catch (e) {
      console.error('  ! scene failed:', name, '—', e.message);
    }
  };

  console.log('Loading', APP);
  await S('Page.navigate', { url: APP });
  await waitFor(`document.querySelector('.qa-rail') && document.querySelector('.qa-app')`);
  await sleep(700); // let the home hero animate in

  // 1. Home
  await scene('01-home');

  // 2. Security RBAC matrix — seed 4 identities x 4 httpbin endpoints, then run live
  await scene('02-security-matrix', async () => {
    const info = await evalJs(`(()=>{
      const KEY='qa_security_matrix';
      const all=(window.QA.COLLECTIONS||[]).flatMap(c=>(c.folders||[]).flatMap(f=>f.requests||[]));
      const find=(p)=>all.find(x=>(x.path||'').includes(p));
      const eps=['/bearer','/basic-auth/user/passwd','/hidden-basic-auth/user/passwd','httpbin.org/get']
        .map(find).filter(Boolean).map(r=>({reqId:r.id,method:r.method,path:r.path}));
      const blank=()=>({type:'none',bearer:'',apiKey:{key:'',value:'',placement:'header'},basic:{user:'',pass:''},aws:{profile:'',service:'',region:''},oauth2:{grant:'client_credentials',authUrl:'',tokenUrl:'',clientId:'',clientSecret:'',scope:'',code:'',redirectUri:'',username:'',password:''}});
      const ids=[
        {id:'anon',name:'anon',auth:blank()},
        {id:'bearer',name:'bearer',auth:{...blank(),type:'bearer',bearer:'demo-token-123'}},
        {id:'basic-ok',name:'basic-ok',auth:{...blank(),type:'basic',basic:{user:'user',pass:'passwd'}}},
        {id:'basic-bad',name:'basic-bad',auth:{...blank(),type:'basic',basic:{user:'user',pass:'wrong'}}},
      ];
      localStorage.setItem(KEY, JSON.stringify({identities:ids,endpoints:eps,expect:{},denySet:[401,403,404]}));
      return {endpoints:eps.length};
    })()`);
    if (!info || info.endpoints < 4)
      throw new Error(
        'httpbin endpoints not found in demo collection (got ' + (info && info.endpoints) + ')'
      );
    await nav('Security');
    await waitFor(`document.querySelector('.qa-sec-grid')`);
    await click('.qa-sec-actions .qa-btn--primary'); // Run all
    await waitFor(`document.querySelectorAll('.qa-sec-verdict').length >= 16`, 40000); // live httpbin calls
  });

  // 3. Test generation — run the heuristic generator on the bundled BDD sample
  await scene('03-test-generation', async () => {
    await nav('Test Gen');
    await waitFor(`document.querySelector('.tg-gen')`);
    await click('.tg-gen');
    await waitFor(`document.querySelector('.tg-case')`, 10000);
  });

  // 4. API client (Postman-style 3-pane + collections tree incl. the demo folders)
  await scene('04-api-client', async () => {
    await nav('API Client');
    await waitFor(`document.querySelector('.qa-api')`);
  });

  // 5. API docs (generated from the loaded collections)
  await scene('05-api-docs', async () => {
    await nav('API Docs');
    await sleep(600);
  });

  // 6. Performance / load testing
  await scene('06-performance', async () => {
    await nav('Performance');
    await sleep(600);
  });

  // 7. Realtime (WS / SSE)
  await scene('07-realtime', async () => {
    await nav('Realtime');
    await sleep(600);
  });

  // 8. Monitors (scheduled collection runs)
  await scene('08-monitors', async () => {
    await nav('Monitors');
    await sleep(600);
  });

  console.log('Done. Screenshots in', OUT_DIR);
  try {
    await S('Page.close');
  } catch {}
  cdp.ws.close();
  chrome.kill();
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
