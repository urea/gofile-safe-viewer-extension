// Local audible-media fixtures. No remote media or user browser profile is used.
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'playwright-audio');
fs.mkdirSync(output, { recursive: true });
const scratch = fs.mkdtempSync(path.join(output, 'run-'));
const openssl = process.env.OPENSSL_PATH || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
const key = path.join(scratch, 'key.pem'), cert = path.join(scratch, 'cert.pem');
const tls = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { encoding: 'utf8' });
if (tls.status !== 0) throw new Error(tls.stderr || 'OpenSSL failed');

const rate = 16000, samples = rate * 30, wave = Buffer.alloc(44 + samples * 2);
wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(rate, 24); wave.writeUInt32LE(rate * 2, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
wave.write('data', 36); wave.writeUInt32LE(samples * 2, 40);
for (let n = 0; n < samples; n++) wave.writeInt16LE(Math.round(800 * Math.sin(2 * Math.PI * 440 * n / rate)), 44 + n * 2);

const fixture = `<!doctype html><title>Audio fixture</title>
<style>video { width:320px;height:180px; } button{margin:8px;padding:10px}</style>
<div class="video-float-ad">ad</div><div id="videos"><video id="video" src="/mvfile/tone.wav" muted autoplay loop controls></video></div>
<button id="interact">Page interaction</button><button id="toggle">Toggle mute</button><button id="pause">Pause</button><button id="next">Next video</button>
<script>
window.loadCount=0;document.addEventListener('loadstart',()=>loadCount++,true);
window.identity=crypto.randomUUID();
document.querySelector('#toggle').onclick=()=>{const v=document.querySelector('#video');v.muted=!v.muted};
document.querySelector('#pause').onclick=()=>document.querySelector('#video').pause();
document.querySelector('#next').onclick=()=>{document.querySelector('#videos').innerHTML='<video id="video" src="/mvfile/tone.wav?next" muted autoplay loop controls></video>'};
</script>`;
const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
  if (req.url.startsWith('/mvfile/tone.wav')) { res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wave.length }); return res.end(wave); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fixture);
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const end = Date.now() + 12000;
  while (Date.now() < end) { if (await fn()) return; await delay(50); }
  throw new Error('Timed out: ' + label);
}
(async () => {
  let context;
  const checks = [];
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'https://localhost:' + server.address().port;
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      channel: 'chromium', headless: true, ignoreHTTPSErrors: true,
      args: ['--disable-extensions-except=' + path.join(root, 'extension'), '--load-extension=' + path.join(root, 'extension'), '--mute-audio', '--autoplay-policy=document-user-activation-required', '--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies']
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extension = 'chrome-extension://' + worker.url().split('/')[2];
    const home = await context.newPage(); await home.goto(extension + '/home.html');
    const send = message => home.evaluate(message => chrome.runtime.sendMessage(message), message);
    // Explicitly omit a synthetic user gesture from all fixture reads/mutations.
    async function attach(page) {
      const cdp = await context.newCDPSession(page);
      const evaluate = async expression => {
        const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: false });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
        return result.result.value;
      };
      const state = () => evaluate(`(()=>{const v=document.querySelector('#video');return {muted:v.muted,paused:v.paused,time:v.currentTime,volume:v.volume,source:v.currentSrc,identity:window.identity,loads:window.loadCount}})()`);
      return { page, evaluate, state };
    }
    async function open(name, protectedTab = true) {
      let page;
      if (protectedTab) {
        const result = await send({ type: 'open', url: base + '/mvfile/' + name }); assert.equal(result.ok, true);
        await until(() => Boolean(page = context.pages().find(p => p.url() === base + '/mvfile/' + name)), 'opened fixture');
      } else { page = await context.newPage(); await page.goto(base + '/ordinary/' + name); }
      const fixturePage = await attach(page);
      await until(async () => { try { const s = await fixturePage.state(); return !s.paused && s.time > 0.1; } catch { return false; } }, 'muted autoplay');
      if (protectedTab) await until(() => fixturePage.evaluate(`getComputedStyle(document.querySelector('.video-float-ad')).display==='none'`), 'protected readiness');
      return fixturePage;
    }
    assert.equal((await send({ type: 'state' })).data.audioAssist, false);
    const off = await open('off'); await off.page.locator('#interact').click(); await delay(100);
    assert.equal((await off.state()).muted, true); await off.page.close();
    checks.push('Default off leaves media muted after interaction');

    await home.bringToFront(); await home.locator('#audio-assist-toggle').check();
    await until(async () => (await send({ type: 'state' })).data.audioAssist === true, 'saved option');
    await home.reload(); assert.equal(await home.locator('#audio-assist-toggle').isChecked(), true);
    checks.push('Home setting persists after reload');

    const active = await open('active'); const before = await active.state(); await delay(150);
    assert.equal((await active.state()).muted, true);
    await active.evaluate(`document.querySelector('#interact').click()`); await delay(100);
    assert.equal((await active.state()).muted, true);
    checks.push('No assist before a genuine page interaction');
    await active.page.locator('#interact').click();
    await until(async () => !(await active.state()).muted, 'assisted unmute');
    const after = await active.state();
    assert.equal(after.paused, false); assert.ok(after.time >= before.time); assert.equal(after.identity, before.identity); assert.equal(after.loads, before.loads);
    assert.equal(after.volume, before.volume);
    checks.push('Real interaction unmutes audible media without restart or volume change');
    await active.page.locator('#toggle').click(); await active.page.locator('#interact').click(); await delay(100);
    assert.equal((await active.state()).muted, true);
    checks.push('Manual remute is respected');
    await active.page.locator('#next').click();
    await until(async () => { const s = await active.state(); return s.source.includes('?next') && !s.paused && !s.muted; }, 'new video assist');
    checks.push('Next video gets assistance after ordinary page operation');
    await delay(5500); // Let transient user activation expire before automatic source change.
    await active.evaluate(`document.querySelector('#videos').innerHTML='<video id="video" src="/mvfile/tone.wav?auto-next" muted autoplay loop controls></video>'`);
    await until(async () => { const s = await active.state(); return s.source.includes('?auto-next') && !s.paused && !s.muted; }, 'later automatic video assist');
    checks.push('Later automatic source change preserves playback after prior interaction');
    await active.page.locator('#pause').click(); await active.page.locator('#interact').click();
    assert.equal((await active.state()).paused, true);
    checks.push('Pause is respected');
    await active.page.close();

    const firstToggle = await open('first-toggle'); await firstToggle.page.locator('#toggle').click(); await delay(100);
    assert.equal((await firstToggle.state()).muted, false);
    await firstToggle.page.locator('#toggle').click(); await firstToggle.page.locator('#interact').click(); await delay(100);
    assert.equal((await firstToggle.state()).muted, true); await firstToggle.page.close();
    checks.push('Site mute toggle does not race with assistance');

    const zero = await open('zero'); await zero.evaluate(`document.querySelector('#video').volume=0`); await zero.page.locator('#interact').click(); await delay(100);
    assert.equal((await zero.state()).muted, true); assert.equal((await zero.state()).volume, 0); await zero.page.close();
    checks.push('Zero volume is left unchanged');
    const hidden = await open('hidden'); await hidden.evaluate(`document.querySelector('#video').style.display='none'`); await hidden.page.locator('#interact').click(); await delay(100);
    assert.equal((await hidden.state()).muted, true); await hidden.page.close();
    checks.push('Hidden video is left unchanged');
    const multiple = await open('multiple');
    await multiple.evaluate(`(()=>{const v=document.querySelector('#video').cloneNode(true);v.id='second';document.querySelector('#videos').append(v);v.muted=true;return v.play()})()`);
    await multiple.page.locator('#interact').click(); await delay(100);
    assert.equal(await multiple.evaluate(`[...document.querySelectorAll('video')].every(v=>v.muted)`), true); await multiple.page.close();
    checks.push('Ambiguous multiple videos are not unmuted together');
    const ordinary = await open('ordinary', false); await ordinary.page.locator('#interact').click(); await delay(100);
    assert.equal((await ordinary.state()).muted, true); await ordinary.page.close();
    checks.push('Ordinary tab is unaffected');

    const disabled = await open('disabled');
    await home.bringToFront(); await home.locator('#audio-assist-toggle').uncheck();
    await until(async () => (await send({ type: 'state' })).data.audioAssist === false, 'disable option');
    await disabled.page.bringToFront(); await disabled.page.locator('#interact').click(); await delay(100);
    assert.equal((await disabled.state()).muted, true); await disabled.page.close();
    checks.push('Disabling immediately stops assistance in an existing tab');
    const report = { passed: checks.length, checks };
    fs.writeFileSync(path.join(output, 'audio-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await context?.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });