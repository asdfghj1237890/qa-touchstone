#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.platform === 'win32' ? 'qa-touchstone-ci.exe' : 'qa-touchstone-ci';
const defaultBin = path.join(repo, 'src-tauri/target/debug', exe);
const qtcBin = process.env.QA_TOUCHSTONE_CI_UNDER_TEST
  ? path.resolve(process.env.QA_TOUCHSTONE_CI_UNDER_TEST)
  : defaultBin;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-headless-functional-'));
const reports = path.join(tmp, 'reports');
fs.mkdirSync(reports, { recursive: true });

const passes = [];
let serverProcess;

function file(name) {
  return path.join(reports, name);
}

function write(name, body) {
  const target = path.join(tmp, name);
  fs.writeFileSync(target, body);
  return target;
}

function writeJson(name, value) {
  return write(name, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(target) {
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

function pass(name) {
  passes.push(name);
  fs.appendFileSync(file('summary.txt'), `PASS ${name}\n`);
}

function runRaw(name, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repo,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (options.stdout) fs.writeFileSync(options.stdout, result.stdout || '');
  if (options.stderr) fs.writeFileSync(options.stderr, result.stderr || '');
  const expected = options.expected ?? 0;
  if (result.status !== expected) {
    throw new Error(
      `${name} expected exit ${expected}, got ${result.status}\n` +
        `command: ${command} ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return result;
}

function ensureLocalBinary() {
  if (process.env.QA_TOUCHSTONE_CI_UNDER_TEST || process.env.QA_TOUCHSTONE_CI_SKIP_BUILD === '1') {
    return;
  }
  runRaw('cargo-build-cli', 'cargo', ['build', '--manifest-path', 'src-tauri/cli/Cargo.toml']);
}

async function startServer() {
  const serverCode = String.raw`
const http = require('node:http');
const basic = 'Basic ' + Buffer.from('robot:p@ss').toString('base64');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/admin/users') {
    return send(req.headers.authorization === 'Bearer functional-token' ? 200 : 403, {
      users: req.headers.authorization === 'Bearer functional-token' ? [{ id: 1 }] : undefined,
      error: req.headers.authorization === 'Bearer functional-token' ? undefined : 'denied',
    });
  }
  if (req.method === 'GET' && url.pathname === '/apikey-header') {
    return send(req.headers['x-api-key'] === 'header-secret' ? 200 : 401, {});
  }
  if (req.method === 'GET' && url.pathname === '/apikey-query') {
    return send(url.searchParams.get('api_key') === 'query-secret' ? 200 : 401, {});
  }
  if (req.method === 'GET' && url.pathname === '/basic') {
    return send(req.headers.authorization === basic ? 200 : 401, {});
  }
  if (req.method === 'GET' && url.pathname.startsWith('/row/')) return send(200, { row: url.pathname.slice('/row/'.length) });
  if (req.method === 'GET' && url.pathname.startsWith('/orders/')) return send(200, { order: url.pathname.slice('/orders/'.length) });
  if (url.pathname === '/leaky') return send(200, { leaky: true });
  if (req.method === 'POST' && url.pathname === '/perf') {
    req.resume();
    return send(200, { perf: true });
  }
  return send(404, { error: 'not found' });
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`;

  serverProcess = spawn(process.execPath, ['-e', serverCode], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const port = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('test server did not publish a port')), 10_000);
    serverProcess.stdout.on('data', (chunk) => {
      out += chunk.toString('utf8');
      const line = out.split(/\r?\n/).find(Boolean);
      if (line) {
        clearTimeout(timer);
        resolve(line.trim());
      }
    });
    serverProcess.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`test server exited before ready: ${code}`));
    });
  });
  return `http://127.0.0.1:${port}`;
}

function makeConfigs(base) {
  const fullConfig = writeJson('full-config.json', {
    version: 1,
    environments: [{ name: 'staging', variables: { baseUrl: base } }],
    identities: [
      { id: 'anon', auth: { type: 'none' } },
      { id: 'api', auth: { type: 'bearer', token: { env: 'API_TOKEN' } } },
      {
        id: 'hkey',
        auth: { type: 'apikey', key: 'X-API-Key', value: { env: 'HEADER_KEY' }, in: 'header' },
      },
      {
        id: 'qkey',
        auth: { type: 'apikey', key: 'api_key', value: { env: 'QUERY_KEY' }, in: 'query' },
      },
      {
        id: 'basic',
        auth: { type: 'basic', username: { env: 'BASIC_USER' }, password: { env: 'BASIC_PASS' } },
      },
    ],
    requests: [
      {
        id: 'health',
        method: 'GET',
        url: '{{baseUrl}}/health',
        assertions: [{ type: 'status', op: 'eq', value: 200 }],
      },
      {
        id: 'admin-users',
        method: 'GET',
        url: '{{baseUrl}}/admin/users',
        privileged: true,
        assertions: [{ type: 'status', op: 'eq', value: 200 }],
      },
      {
        id: 'apikey-header',
        method: 'GET',
        url: '{{baseUrl}}/apikey-header',
        assertions: [{ type: 'status', op: 'eq', value: 200 }],
      },
      {
        id: 'apikey-query',
        method: 'GET',
        url: '{{baseUrl}}/apikey-query',
        assertions: [{ type: 'status', op: 'eq', value: 200 }],
      },
      {
        id: 'basic-auth',
        method: 'GET',
        url: '{{baseUrl}}/basic',
        assertions: [{ type: 'status', op: 'eq', value: 200 }],
      },
      {
        id: 'row-check',
        method: 'GET',
        url: '{{baseUrl}}/row/{{row}}',
        assertions: [{ type: 'status', op: 'eq', value: 200 }],
      },
      {
        id: 'broken-status',
        method: 'GET',
        url: '{{baseUrl}}/health',
        assertions: [{ type: 'status', op: 'eq', value: 500 }],
      },
      { id: 'order-lookup', method: 'GET', url: '{{baseUrl}}/orders/12345?userId=42' },
      {
        id: 'perf-post',
        method: 'POST',
        url: '{{baseUrl}}/perf',
        body: { mode: 'json', content: '{"ok":true}' },
      },
    ],
    collections: [
      { id: 'smoke', requests: ['health', 'admin-users'] },
      { id: 'data-suite', requests: ['row-check'] },
      { id: 'fail-suite', requests: ['broken-status'] },
      { id: 'perf-suite', requests: ['perf-post'] },
    ],
  });

  const scanClean = writeJson('scan-clean.json', {
    version: 1,
    environments: [{ name: 'staging', variables: { baseUrl: base } }],
    identities: [
      { id: 'anon', auth: { type: 'none' } },
      { id: 'api', auth: { type: 'bearer', token: { env: 'API_TOKEN' } } },
    ],
    requests: [
      { id: 'admin-users', method: 'GET', url: '{{baseUrl}}/admin/users', privileged: true },
    ],
    security: {
      matrix: {
        endpoints: ['admin-users'],
        expect: { 'admin-users': { anon: 'deny', api: 'allow' } },
      },
      oracles: { sensitive: false, schema: false },
    },
  });

  const scanVuln = writeJson('scan-vuln.json', {
    version: 1,
    environments: [{ name: 'staging', variables: { baseUrl: base } }],
    identities: [{ id: 'lp', auth: { type: 'bearer', token: 'SUPERSECRET' } }],
    requests: [{ id: 'leaky', method: 'GET', url: '{{baseUrl}}/leaky' }],
    security: { matrix: { endpoints: ['leaky'], expect: { leaky: { lp: 'deny' } } } },
  });

  const missingEnv = writeJson('missing-env.json', {
    version: 1,
    environments: [{ name: 'staging', variables: { baseUrl: base } }],
    identities: [{ id: 'bad', auth: { type: 'bearer', token: { env: 'NO_SUCH_TOKEN' } } }],
    requests: [{ id: 'health', method: 'GET', url: '{{baseUrl}}/health' }],
  });

  const openapi = writeJson('openapi.json', {
    openapi: '3.0.0',
    info: { title: 'Functional API', version: '1.0.0' },
    servers: [{ url: base }],
    paths: {
      '/health': { get: { operationId: 'getHealth', responses: { 200: { description: 'OK' } } } },
      '/orders/{id}': {
        get: {
          operationId: 'getOrder',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'OK' } },
        },
      },
    },
  });

  return { fullConfig, scanClean, scanVuln, missingEnv, openapi };
}

function assertReportFiles(scanName) {
  if (readJson(file(`${scanName}.sarif`)).version !== '2.1.0') {
    throw new Error(`${scanName} SARIF version invalid`);
  }
  if (!fs.readFileSync(file(`${scanName}.html`), 'utf8').includes('<!doctype html>')) {
    throw new Error(`${scanName} HTML report missing`);
  }
  if (!fs.readFileSync(file(`${scanName}.xml`), 'utf8').includes('<testsuites')) {
    throw new Error(`${scanName} JUnit report missing`);
  }
}

function runOptionalReleaseInstallerChecks(base, scanClean) {
  const npxVersion = process.env.QA_TOUCHSTONE_CI_TEST_NPX_VERSION;
  if (npxVersion) {
    const env = {
      HOME: path.join(tmp, 'npx-home'),
      npm_config_cache: path.join(tmp, 'npx-cache'),
      QA_TOUCHSTONE_CI_CACHE_DIR: path.join(tmp, 'npx-qtc-cache'),
    };
    const out = runRaw(
      'npx-version',
      'npx',
      ['--yes', `qa-touchstone-ci@${npxVersion}`, '--version'],
      {
        cwd: tmp,
        env,
        stdout: file('npx-version.txt'),
      }
    ).stdout;
    if (!out.includes(npxVersion.replace(/^v/, ''))) throw new Error('npx version mismatch');
    pass(`npx ${npxVersion} --version`);
  }

  if (process.env.QA_TOUCHSTONE_CI_TEST_SETUP_ACTION === '1') {
    const packageJson = readJson(path.join(repo, 'packages/qa-touchstone-ci/package.json'));
    const version = process.env.QA_TOUCHSTONE_CI_SETUP_VERSION || `v${packageJson.version}`;
    const actionInstall = path.join(tmp, 'action-bin');
    const actionScript = `set -euo pipefail
install_dir="${'${INPUT_INSTALL_DIR:-${RUNNER_TEMP}/qa-touchstone-ci/bin}'}"
version="$INPUT_VERSION"
if [[ -z "$version" && "${'${INPUT_ACTION_REF:-}'}" == v* ]]; then version="$INPUT_ACTION_REF"; fi
export QA_TOUCHSTONE_CI_INSTALL_ONLY=1
export QA_TOUCHSTONE_CI_INSTALL_DIR="$install_dir"
export QA_TOUCHSTONE_CI_REPO="$INPUT_REPO"
export QA_TOUCHSTONE_CI_VERSION="$version"
node "$GITHUB_ACTION_PATH/../packages/qa-touchstone-ci/bin/qa-touchstone-ci.mjs" >/tmp/qa-touchstone-action-functional-path.txt
"$install_dir/${exe}" --version
`;
    runRaw('setup-ci-install', 'bash', ['-lc', actionScript], {
      cwd: repo,
      env: {
        GITHUB_ACTION_PATH: path.join(repo, 'setup-ci'),
        RUNNER_TEMP: path.join(tmp, 'runner'),
        INPUT_VERSION: version,
        INPUT_REPO: process.env.QA_TOUCHSTONE_CI_SETUP_REPO || 'asdfghj1237890/qa-touchstone',
        INPUT_INSTALL_DIR: actionInstall,
        QA_TOUCHSTONE_CI_CACHE_DIR: path.join(tmp, 'action-cache'),
      },
      stdout: file('action-install.txt'),
    });
    const actionBin = path.join(actionInstall, exe);
    runRaw(
      'action-send',
      actionBin,
      [
        'send',
        '--config',
        scanClean,
        '--request',
        'admin-users',
        '--identity',
        'api',
        '--env',
        'staging',
        '--json',
      ],
      {
        cwd: tmp,
        env: { API_TOKEN: 'functional-token' },
        stdout: file('action-send.json'),
      }
    );
    runRaw(
      'action-scan',
      actionBin,
      [
        'scan',
        '--config',
        scanClean,
        '--env',
        'staging',
        '--json',
        '--out',
        file('action-scan.json'),
        '--html',
        file('action-scan.html'),
        '--junit',
        file('action-scan.xml'),
        '--sarif',
        file('action-scan.sarif'),
        '--fail-on',
        'high',
      ],
      {
        cwd: tmp,
        env: { API_TOKEN: 'functional-token' },
        stdout: file('action-scan-stdout.json'),
      }
    );
    if (
      !readJson(file('action-send.json')).success ||
      readJson(file('action-scan.json')).findings.length !== 0
    ) {
      throw new Error('setup-ci installed binary failed functional commands');
    }
    pass(`setup-ci ${version} installed binary send + scan`);
  }

  fs.writeFileSync(file('base.txt'), `${base}\n`);
}

try {
  ensureLocalBinary();
  const base = await startServer();
  const { fullConfig, scanClean, scanVuln, missingEnv, openapi } = makeConfigs(base);
  const env = {
    API_TOKEN: 'functional-token',
    HEADER_KEY: 'header-secret',
    QUERY_KEY: 'query-secret',
    BASIC_USER: 'robot',
    BASIC_PASS: 'p@ss',
  };
  const qtc = (name, args, options = {}) =>
    runRaw(name, qtcBin, args, {
      cwd: tmp,
      env: { ...env, ...(options.env || {}) },
      ...options,
    });

  const version = qtc('version', ['--version'], { stdout: file('version.txt') }).stdout;
  if (!version.includes('qa-touchstone-ci')) throw new Error('version output missing binary name');
  pass('version');

  qtc('import', ['import', '--input', openapi, '--base-url', base, '--out', file('imported.json')]);
  if (readJson(file('imported.json')).requests.length < 2) throw new Error('import output invalid');
  pass('import openapi');

  qtc('ping', ['ping', '--url', `${base}/health`], { stdout: file('ping.txt') });
  if (!fs.readFileSync(file('ping.txt'), 'utf8').includes('200'))
    throw new Error('ping missing 200');
  pass('ping');

  for (const [name, request, identity] of [
    ['send-health', 'health', 'api'],
    ['send-bearer', 'admin-users', 'api'],
    ['send-apikey-header', 'apikey-header', 'hkey'],
    ['send-apikey-query', 'apikey-query', 'qkey'],
    ['send-basic', 'basic-auth', 'basic'],
  ]) {
    qtc(
      name,
      [
        'send',
        '--config',
        fullConfig,
        '--request',
        request,
        '--identity',
        identity,
        '--env',
        'staging',
        '--json',
      ],
      { stdout: file(`${name}.json`) }
    );
    const out = readJson(file(`${name}.json`));
    if (out.success !== true || out.status !== 200) throw new Error(`${name} failed`);
  }
  pass('send auth variants');

  qtc(
    'send-missing-env',
    [
      'send',
      '--config',
      missingEnv,
      '--request',
      'health',
      '--identity',
      'bad',
      '--env',
      'staging',
      '--json',
    ],
    {
      expected: 2,
      stdout: file('send-missing-env.stdout'),
      stderr: file('send-missing-env.stderr'),
    }
  );
  if (!fs.readFileSync(file('send-missing-env.stderr'), 'utf8').includes('NO_SUCH_TOKEN')) {
    throw new Error('missing env did not fail closed');
  }
  pass('send missing env exit 2');

  qtc(
    'run-smoke',
    [
      'run',
      '--config',
      fullConfig,
      '--collection',
      'smoke',
      '--identity',
      'api',
      '--env',
      'staging',
      '--iterations',
      '2',
      '--junit',
      file('run-smoke.xml'),
      '--json',
    ],
    { stdout: file('run-smoke.json') }
  );
  let runReport = readJson(file('run-smoke.json'));
  if (
    !runReport.ok ||
    runReport.iterations !== 2 ||
    runReport.totals.failed !== 0 ||
    runReport.totals.errors !== 0
  ) {
    throw new Error('run smoke failed');
  }
  if (fs.readFileSync(file('run-smoke.xml'), 'utf8').includes('<failure'))
    throw new Error('run smoke junit has failure');
  pass('run iterations + junit');

  const dataCsv = write('data.csv', 'row\nalpha\nbeta\n');
  qtc(
    'run-data',
    [
      'run',
      '--config',
      fullConfig,
      '--collection',
      'data-suite',
      '--identity',
      'api',
      '--env',
      'staging',
      '--data',
      dataCsv,
      '--junit',
      file('run-data.xml'),
      '--json',
    ],
    { stdout: file('run-data.json') }
  );
  runReport = readJson(file('run-data.json'));
  if (!runReport.ok || runReport.iterations !== 2 || runReport.totals.requests !== 2)
    throw new Error('data run failed');
  pass('run csv data iterations');

  qtc(
    'run-fail',
    [
      'run',
      '--config',
      fullConfig,
      '--collection',
      'fail-suite',
      '--identity',
      'api',
      '--env',
      'staging',
      '--junit',
      file('run-fail.xml'),
      '--json',
    ],
    { expected: 4, stdout: file('run-fail.json') }
  );
  runReport = readJson(file('run-fail.json'));
  if (
    runReport.ok !== false ||
    runReport.totals.failed < 1 ||
    !fs.readFileSync(file('run-fail.xml'), 'utf8').includes('<failure')
  ) {
    throw new Error('run failure not reported');
  }
  pass('run assertion failure exit 4');

  qtc(
    'scan-clean',
    [
      'scan',
      '--config',
      scanClean,
      '--env',
      'staging',
      '--json',
      '--out',
      file('scan-clean.json'),
      '--html',
      file('scan-clean.html'),
      '--junit',
      file('scan-clean.xml'),
      '--sarif',
      file('scan-clean.sarif'),
      '--fail-on',
      'high',
    ],
    { stdout: file('scan-clean-stdout.json') }
  );
  let scan = readJson(file('scan-clean.json'));
  if (scan.findings.length !== 0 || scan.totals.errors !== 0) throw new Error('clean scan invalid');
  assertReportFiles('scan-clean');
  pass('scan clean reports');

  qtc(
    'scan-vuln',
    [
      'scan',
      '--config',
      scanVuln,
      '--env',
      'staging',
      '--json',
      '--out',
      file('scan-vuln.json'),
      '--html',
      file('scan-vuln.html'),
      '--junit',
      file('scan-vuln.xml'),
      '--sarif',
      file('scan-vuln.sarif'),
      '--fail-on',
      'high',
    ],
    { expected: 3, stdout: file('scan-vuln-stdout.json') }
  );
  scan = readJson(file('scan-vuln.json'));
  if (!scan.findings.some((f) => f.rule_id === 'matrix.deny-bypass'))
    throw new Error('vuln finding missing');
  if (JSON.stringify(scan).includes('SUPERSECRET')) throw new Error('secret leaked in scan report');
  if (!readJson(file('scan-vuln.sarif')).runs?.[0]?.results?.length)
    throw new Error('vuln SARIF missing results');
  if (
    !fs.readFileSync(file('scan-vuln.html'), 'utf8').includes('matrix.deny-bypass') ||
    !fs.readFileSync(file('scan-vuln.xml'), 'utf8').includes('<failure')
  ) {
    throw new Error('vuln reports missing');
  }
  pass('scan vuln exit 3 reports redacted');

  const baseline = file('security-baseline.json');
  fs.writeFileSync(baseline, '');
  qtc(
    'baseline-new',
    ['scan', '--config', scanVuln, '--env', 'staging', '--baseline', baseline, '--json'],
    { expected: 3, stdout: file('baseline-new.json') }
  );
  qtc(
    'baseline-update',
    [
      'scan',
      '--config',
      scanVuln,
      '--env',
      'staging',
      '--baseline',
      baseline,
      '--update-baseline',
      '--json',
    ],
    { stdout: file('baseline-update.json') }
  );
  qtc(
    'baseline-carried',
    ['scan', '--config', scanVuln, '--env', 'staging', '--baseline', baseline, '--json'],
    { stdout: file('baseline-carried.json') }
  );
  if (fs.readFileSync(baseline, 'utf8').includes('SUPERSECRET'))
    throw new Error('secret leaked into baseline');
  pass('scan baseline new/update/carried redacted');

  qtc('bola-suggest', ['bola-suggest', '--config', fullConfig, '--env', 'staging', '--json'], {
    stdout: file('bola-suggest.json'),
  });
  const bola = readJson(file('bola-suggest.json')).find((r) => r.request === 'order-lookup');
  if (!bola?.candidates?.length || !bola.stub)
    throw new Error('bola suggest did not find candidate');
  pass('bola-suggest json');

  const fakeK6 = write(
    'fake-k6.sh',
    `#!/bin/sh\nset -eu\nsummary=""\nlast=""\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "--summary-export" ]; then\n    shift\n    summary="$1"\n  fi\n  last="$1"\n  shift\ndone\nif [ -n "$summary" ]; then\n  printf '{"metrics":{"http_reqs":{"count":1}}}\\n' > "$summary"\nfi\nprintf 'fake k6 ran %s\\n' "$last"\nexit 0\n`
  );
  fs.chmodSync(fakeK6, 0o755);
  qtc(
    'perf',
    [
      'perf',
      '--config',
      fullConfig,
      '--request',
      'perf-post',
      '--identity',
      'hkey',
      '--env',
      'staging',
      '--collection',
      'perf-suite',
      '--stage',
      '1s:2',
      '--stage',
      '2s:0',
      '--k6-bin',
      fakeK6,
      '--script-out',
      file('perf-script.js'),
      '--summary-out',
      file('perf-summary.json'),
      '--no-keepalive',
      '--timeout-ms',
      '5000',
      '--json',
    ],
    { stdout: file('perf.json') }
  );
  const perf = readJson(file('perf.json'));
  if (!perf.ok || perf.k6ExitCode !== 0 || !String(perf.stdout).includes('fake k6 ran'))
    throw new Error('perf fake k6 failed');
  if (JSON.stringify(perf).includes('header-secret')) throw new Error('perf JSON leaked secret');
  if (
    !fs.readFileSync(file('perf-summary.json'), 'utf8').includes('http_reqs') ||
    !fs.readFileSync(file('perf-script.js'), 'utf8').includes('header-secret')
  ) {
    throw new Error('perf artifacts invalid');
  }
  pass('perf fake k6 summary redacted json');

  qtc(
    'perf-missing',
    [
      'perf',
      '--config',
      fullConfig,
      '--request',
      'perf-post',
      '--identity',
      'hkey',
      '--env',
      'staging',
      '--k6-bin',
      path.join(tmp, 'missing-k6'),
      '--json',
    ],
    { expected: 1, stdout: file('perf-missing.json') }
  );
  if (!String(readJson(file('perf-missing.json')).error).includes('was not found'))
    throw new Error('perf missing k6 did not fail correctly');
  pass('perf missing k6 exit 1');

  runOptionalReleaseInstallerChecks(base, scanClean);

  console.log('\nHEADLESS FUNCTIONAL SUMMARY');
  for (const name of passes) console.log(`PASS ${name}`);
  console.log(`binary=${qtcBin}`);
  console.log(`reports=${reports}`);
  console.log(`base=${base}`);
  console.log(`artifact count=${fs.readdirSync(reports).length}`);
} finally {
  if (serverProcess && !serverProcess.killed) serverProcess.kill('SIGTERM');
}
