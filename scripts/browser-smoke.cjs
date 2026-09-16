// Run with Node + Playwright (library API is needed for a persistent extension context).
// Self-signed TLS is accepted only inside this disposable test browser.
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'playwright');
fs.mkdirSync(output, {recursive: true});
const scratch = fs.mkdtempSync(path.join(output, 'run-'));
const openssl = process.env.OPENSSL_PATH || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
const key = path.join(scratch, 'key.pem');
const cert = path.join(scratch, 'cert.pem');
const result = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
  '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], {encoding: 'utf8'});
if (result.status !== 0) throw new Error(result.stderr);
const requests = [];
const server = https.createServer({key: fs.readFileSync(key), cert: fs.readFileSync(cert)}, (req, res) => {
  requests.push(req.url);
  if (req.url.startsWith('/mvfile/redirect')) { res.writeHead(302, {Location: '/redirect-denied'}); return res.end(); }
  if (req.url.startsWith('/mvfile/attachment')) { res.writeHead(200, {'Content-Disposition': 'attachment; filename="test.txt"'}); return res.end('fixture'); }
  if (req.url.endsWith('.js')) { res.writeHead(200, {'Content-Type': 'text/javascript'}); return res.end('window.assetLoaded = true;'); }
  if (req.url.endsWith('.css')) { res.writeHead(200, {'Content-Type': 'text/css'}); return res.end('body { font-family: system-ui; }'); }
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  res.end(`<!doctype html><html><head><title>MVFILE fixture</title><link rel="stylesheet" href="/mvfile/ok.css"><script src="/denied.js"></script><script src="/mvfile/ok.js"></script></head><body>
    <h1>閲覧テスト</h1><div class="video-float-ad">ad fixture</div>
    <a id="newtab" target="_blank" href="/mvfile/next">新しいタブのリンク</a>
    <a id="download" download href="/mvfile/file">保存</a>
    <a id="external" href="mailto:fixture@example.test">メール</a>
    <a id="blocked" href="/denied-page">対象外</a><script>fetch('/mvfile/attachment-subresource').then(r=>r.text()).then(text=>window.attachmentSubresource=text).catch(()=>window.attachmentSubresource='blocked')</script></body></html>`);
});
const checks = [];
async function until(fn, description, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Timed out: ' + description);
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `https://localhost:${server.address().port}`;
  const launchOptions = {
    channel: 'chromium', headless: true, ignoreHTTPSErrors: true, viewport: {width: 1320, height: 960},
    args: [`--disable-extensions-except=${path.join(root, 'extension')}`, `--load-extension=${path.join(root, 'extension')}`]
  };
  let context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), launchOptions);
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  worker.on('console', message => console.log('worker:', message.text()));
  const extensionId = worker.url().split('/')[2];
  const errors = [];
  const watch = page => page.on('pageerror', e => errors.push(e.message));
  context.pages().forEach(watch); context.on('page', watch);
  try {
    const home = await context.newPage();
    await home.goto(`chrome-extension://${extensionId}/home.html`);
    const send = message => home.evaluate(message => chrome.runtime.sendMessage(message), message);
    await until(async () => (await send({type: 'state'})).ok, 'worker initialization');
    await home.locator('.brand').click();
    assert.ok((await send({type: 'state'})).ok, 'Home hash navigation must remain authorized');
    checks.push('Unpacked extension and home loaded without worker errors');
    await home.locator('#url-input').fill('http://mvfile.example/');
    await home.locator('#open-button').click();
    await until(async () => (await home.locator('#open-status').innerText()).includes('HTTPS'), 'invalid URL feedback');
    assert.equal((await send({type: 'state'})).data.tabs.length, 0);
    checks.push('Invalid HTTP URL rejected by UI');
    await home.locator('#url-input').fill(base + '/mvfile/start');
    await home.locator('#open-button').click();
    const tab = await until(async () => (await send({type: 'state'})).data.tabs[0], 'protected tab created');
    const page = await until(() => context.pages().find(p => p.url().includes('/mvfile/start')), 'fixture navigation');
    await page.waitForLoadState('load');
    const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    assert.ok(rules.every(r => r.condition.tabIds.includes(tab.id)));
    await until(async () => (await worker.evaluate(id => chrome.action.getBadgeText({tabId: id}), tab.id)) === 'SAFE', 'SAFE badge after navigation');
    assert.ok(requests.includes('/mvfile/ok.js'));
    assert.ok(!requests.includes('/denied.js'));
    await until(() => page.evaluate(() => window.attachmentSubresource === 'fixture'), 'attachment subresource allowed');
    checks.push('Content-Disposition attachment subresource allowed for in-page viewing');
    await until(() => page.locator('.video-float-ad').evaluate(e => getComputedStyle(e).display === 'none'), 'content protection');
    checks.push('Allowed navigation/resource passed; denied script never reached server; badge and ad cleanup active');
    await home.bringToFront();
    const untouched = await context.newPage();
    await untouched.goto(base + '/ordinary');
    assert.ok(requests.includes('/denied.js'));
    assert.equal(await untouched.locator('.video-float-ad').evaluate(e => getComputedStyle(e).display), 'block');
    checks.push('Ordinary tab network and page unaffected');
    await send({type: 'bookmark-add', url: base + '/mvfile/start', title: '<img src=x onerror=alert(1)> fixture'});
    await send({type: 'bookmark-add', url: base + '/mvfile/start', title: 'duplicate'});
    assert.equal((await send({type: 'state'})).data.bookmarks.length, 1);
    await home.bringToFront(); await home.reload();
    await home.locator('#bookmark-search').fill('onerror');
    await until(async () => await home.locator('#bookmarks-list .item').count() === 1, 'bookmark rendering');
    assert.equal(await home.locator('#bookmarks-list img').count(), 0);
    checks.push('Bookmarks persist, deduplicate and render external titles as text');
    await home.locator('#bookmark-search').fill('');
    await home.screenshot({path: path.join(output, 'home.png'), fullPage: true});
    await page.bringToFront();
    await page.locator('#newtab').click();
    await page.waitForURL('**/mvfile/next');
    assert.equal((await send({type: 'state'})).data.tabs.length, 1);
    await page.waitForLoadState('load');
    await until(() => page.locator('.video-float-ad').evaluate(e => getComputedStyle(e).display === 'none'), 'next page scripts');
    let downloads = 0; const downloadItems = []; page.on('download', item => { downloads++; downloadItems.push(item); });
    await page.locator('#download').click();
    assert.ok(!requests.includes('/mvfile/file'));
    assert.equal(downloads, 0);
    assert.equal(await page.evaluate(() => window.open('/mvfile/popup')), null);
    checks.push('Target=_blank stays in protected tab; download click and window.open suppressed');
    await page.goto(base + '/mvfile/attachment').catch(() => {});
    await new Promise(r => setTimeout(r, 400));
    assert.equal(downloads, 0);
    assert.ok(requests.includes('/mvfile/attachment'));
    checks.push('Content-Disposition attachment response blocked');
    await page.goto(base + '/mvfile/redirect').catch(() => {});
    assert.ok(!requests.includes('/redirect-denied'));
    checks.push('Redirect to disallowed URL blocked before network');
    const extra = await Promise.all([send({type: 'open', url: base + '/mvfile/one'}), send({type: 'open', url: base + '/mvfile/two'})]);
    assert.ok(extra.every(r => r.ok));
    const ids = (await send({type: 'state'})).data.tabs.map(t => t.id);
    const currentRules = await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    assert.deepEqual([...currentRules[0].condition.tabIds].sort(), [...ids].sort());
    checks.push('Concurrent opens retain all protected tab scopes');
    const decisions = await worker.evaluate(async tabId => {
      const cases = [
        ['https://x.com/home', 'main_frame', 3], ['https://api.x.com/a', 'main_frame', 3],
        ['https://t.co/a', 'main_frame', 3], ['https://sub.t.co/a', 'main_frame', 1],
        ['https://x.com.evil.test/', 'main_frame', 1], ['https://fun800.click/a', 'main_frame', 1],
        ['https://cdn.fun800.click/a', 'media', 4], ['http://mvfile.test/', 'main_frame', 1],
        ['https://example.test/?q=MVFILE', 'main_frame', 2]
      ];
      const result = [];
      for (const [url, type, expected] of cases) {
        const response = await chrome.declarativeNetRequest.testMatchOutcome({url, type, tabId});
        result.push({url, expected, matched: response.matchedRules.map(r => r.ruleId)});
      }
      return result;
    }, ids[0]);
    for (const item of decisions) assert.ok(item.matched.includes(item.expected), JSON.stringify(item));
    checks.push('Chromium DNR matches X, exact t.co, media-only host, HTTP rejection and uppercase token cases');
    // Stop the real MV3 worker; a subsequent UI message must reconstruct tab state
    // from browser session rules, not fresh in-memory defaults.
    const cdp = await context.newCDPSession(home);
    const versions = new Map();
    cdp.on('ServiceWorker.workerVersionUpdated', ({versions: changed}) => changed.forEach(v => versions.set(v.versionId, v)));
    await cdp.send('ServiceWorker.enable');
    const version = await until(() => [...versions.values()].find(v => v.scriptURL === worker.url() && v.runningStatus === 'running'), 'worker version');
    await cdp.send('ServiceWorker.stopWorker', {versionId: version.versionId});
    await until(() => [...versions.values()].some(v => v.versionId === version.versionId && v.runningStatus === 'stopped'), 'worker stopped');
    const resumed = await send({type: 'state'});
    assert.deepEqual(resumed.data.tabs.map(t => t.id).sort(), [...ids].sort());
    checks.push('Worker suspension/restart reconstructs protected tabs');
    // A page content script may query its own status, but cannot read bookmarks.
    const unauthorized = await worker.evaluate(async id => {
      const result = await chrome.scripting.executeScript({target: {tabId: id}, func: async () => chrome.runtime.sendMessage({type: 'state'})});
      return result[0].result;
    }, ids[1]);
    assert.equal(unauthorized.ok, false);
    checks.push('Content-script sender cannot read privileged bookmark/state data');
    await cdp.detach();
    for (const id of ids) assert.ok((await send({type: 'close', tabId: id})).ok);
    assert.equal((await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).length, 0);
    await send({type: 'bookmark-remove', url: base + '/mvfile/start'});
    assert.equal((await send({type: 'state'})).data.bookmarks.length, 0);
    checks.push('Closing tabs removes rules; bookmark removal succeeds');
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await until(async () => (await popup.locator('#safe-badge').innerText()) !== '確認中', 'popup');
    await popup.setViewportSize({width: 420, height: 680});
    await popup.screenshot({path: path.join(output, 'popup.png'), fullPage: true});
    assert.deepEqual(errors, []);
    await send({type: 'bookmark-add', url: base + '/mvfile/persist', title: 'Restart fixture'});
    await send({type: 'open', url: base + '/mvfile/restart'});
    await context.close();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {...launchOptions,
      args: [...launchOptions.args, '--restore-last-session']});
    const newWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const restartedHome = await context.newPage();
    await restartedHome.goto(`chrome-extension://${extensionId}/home.html`);
    const afterRestart = await restartedHome.evaluate(() => chrome.runtime.sendMessage({type: 'state'}));
    assert.equal(afterRestart.ok, true);
    assert.equal(afterRestart.data.tabs.length, 0);
    assert.equal(afterRestart.data.bookmarks.length, 1);
    assert.equal((await newWorker.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).length, 0);
    checks.push('Full browser restart clears session protection, keeps bookmarks and requires explicit reopen');
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({checks, pageErrors: errors, requests}, null, 2));
    console.log(JSON.stringify({passed: checks.length, checks, pageErrors: errors}, null, 2));
  } finally { await context.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
