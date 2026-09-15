import {buildRules, extractAllowedUrl, parseAllowedUrl, TOKEN_PATTERN, HOST_PATTERN} from './policy.js';

const protectedTabs = new Set();
let audioAssistEnabled = false;
const rootUrl = chrome.runtime.getURL('');
let chain = Promise.resolve();
const ready = initialize();
function serial(task) {
  const result = chain.then(() => ready).then(task);
  chain = result.catch(() => {});
  return result;
}
function report(error) { console.error('GSV:', error.message || String(error)); }

async function initialize() {
  audioAssistEnabled = (await chrome.storage.local.get('audioAssist')).audioAssist === true;
  // Session rules are the source of truth, including after a worker suspension.
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const ids = rules.find(rule => rule.id === 1)?.condition.tabIds ?? [];
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (ids.includes(tab.id)) protectedTabs.add(tab.id);
    await badge(tab.id, ids.includes(tab.id));
  }
  await installRules();
}

async function badge(tabId, enabled) {
  try {
    await chrome.action.setBadgeText({tabId, text: enabled ? 'SAFE' : ''});
    if (enabled) await chrome.action.setBadgeBackgroundColor({tabId, color: '#147d68'});
    await chrome.action.setTitle({tabId, title: enabled ? 'Gofile Safe Viewer ブラウザ拡張版：閲覧制限中' : 'Gofile Safe Viewer ブラウザ拡張版'});
  } catch (error) { console.warn('Badge update failed:', tabId, error.message); }
}
async function installRules() {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: rules.map(rule => rule.id), addRules: buildRules([...protectedTabs])
  });
  await chrome.storage.session.set({protectedTabIds: [...protectedTabs]});
}
async function openProtected(raw) {
  const url = extractAllowedUrl(raw);
  if (!url) throw new Error('許可対象のHTTPS URLを入力してください（gofile / twimg / mvfile、x.com、t.co）。');
  const tab = await chrome.tabs.create({url: 'about:blank', active: true});
  try {
    protectedTabs.add(tab.id);
    // Install atomically before the first external navigation.
    await installRules();
    await badge(tab.id, true);
    const pending = await chrome.tabs.get(tab.id);
    if (pending.url !== 'about:blank' || (pending.pendingUrl && pending.pendingUrl !== 'about:blank')) {
      throw new Error('準備中にタブが変更されました。もう一度ホームから開いてください。');
    }
    await chrome.tabs.update(tab.id, {url});
    return {tabId: tab.id};
  } catch (error) {
    // Keep rules until the tab is closed on setup failure.
    await chrome.tabs.remove(tab.id).catch(() => {});
    protectedTabs.delete(tab.id);
    await installRules().catch(report);
    throw error;
  }
}
async function getBookmarks() {
  const {bookmarks = []} = await chrome.storage.local.get('bookmarks');
  return Array.isArray(bookmarks) ? bookmarks.filter(item => item && parseAllowedUrl(item.url)) : [];
}
async function getState() {
  const tabs = [];
  for (const id of protectedTabs) {
    try {
      const tab = await chrome.tabs.get(id);
      tabs.push({id, url: tab.url || tab.pendingUrl || '', title: tab.title || '閲覧タブ'});
    } catch { /* onRemoved will prune the rules. */ }
  }
  return {version: chrome.runtime.getManifest().version, tabs, bookmarks: await getBookmarks(), audioAssist: audioAssistEnabled};
}
async function home() {
  const url = chrome.runtime.getURL('home.html');
  const tabs = await chrome.tabs.query({url});
  if (tabs[0]) {
    await chrome.tabs.update(tabs[0].id, {active: true});
    await chrome.windows.update(tabs[0].windowId, {focused: true});
  } else await chrome.tabs.create({url});
}
async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') throw new Error('許可されていない操作です。');
  const source = (sender.url || '').split(/[?#]/)[0];
  const internal = source === rootUrl + 'home.html' || source === rootUrl + 'popup.html';
  const fromProtected = sender.tab && protectedTabs.has(sender.tab.id);
  if (message.type === 'is-protected') return {protected: Boolean(fromProtected), navigationPatterns: [TOKEN_PATTERN, HOST_PATTERN], audioAssist: audioAssistEnabled};
  if (message.type === 'navigate' && fromProtected) {
    const url = parseAllowedUrl(message.url);
    if (!url) throw new Error('このリンクは許可対象外です。');
    await chrome.tabs.update(sender.tab.id, {url});
    return {};
  }
  if (!internal) throw new Error('この操作は拡張機能のホームから行ってください。');
  switch (message.type) {
    case 'state': return getState();
    case 'audio-assist-set':
      if (typeof message.enabled !== 'boolean') throw new Error('音声設定を確認してください。');
      await chrome.storage.local.set({audioAssist: message.enabled});
      audioAssistEnabled = message.enabled;
      return {enabled: audioAssistEnabled};
    case 'open': return openProtected(message.url);
    case 'home': await home(); return {};
    case 'focus': {
      if (!protectedTabs.has(message.tabId)) throw new Error('閲覧タブが見つかりません。');
      const tab = await chrome.tabs.update(message.tabId, {active: true});
      await chrome.windows.update(tab.windowId, {focused: true});
      return {};
    }
    case 'close':
      if (!protectedTabs.has(message.tabId)) throw new Error('閲覧タブが見つかりません。');
      await chrome.tabs.remove(message.tabId);
      protectedTabs.delete(message.tabId);
      await installRules();
      return {};
    case 'bookmark-add': {
      const url = parseAllowedUrl(message.url);
      if (!url) throw new Error('このURLはブックマークに保存できません。');
      const bookmarks = await getBookmarks();
      if (!bookmarks.some(item => item.url === url)) {
        if (bookmarks.length >= 2000) throw new Error('ブックマークは最大2,000件です。');
        bookmarks.unshift({url, title: String(message.title || url).slice(0, 300), addedAt: Date.now()});
        await chrome.storage.local.set({bookmarks});
      }
      return {};
    }
    case 'bookmark-remove':
      await chrome.storage.local.set({bookmarks: (await getBookmarks()).filter(item => item.url !== message.url)});
      return {};
    case 'bookmarks-clear': await chrome.storage.local.remove('bookmarks'); return {};
    default: throw new Error('不明な操作です。');
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  serial(() => handle(message, sender)).then(data => respond({ok: true, data}), error => respond({ok: false, error: error.message}));
  return true;
});
chrome.tabs.onRemoved.addListener(id => {
  serial(async () => { if (protectedTabs.delete(id)) await installRules(); }).catch(report);
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (!change.status && !change.url && !change.title) return;
  serial(async () => {
    if (!protectedTabs.has(id)) return;
    // Chrome resets tab-specific action appearance on navigation.
    await badge(id, true);
    await chrome.storage.session.set({tabRevision: Date.now()});
  }).catch(report);
});
chrome.tabs.onReplaced.addListener((added, removed) => {
  serial(async () => {
    if (protectedTabs.delete(removed)) {
      protectedTabs.add(added);
      await installRules();
      await badge(added, true);
    }
  }).catch(report);
});
// Closing a new tab is reactive; the first request may precede this event.
function closePopup(sourceId, targetId) {
  serial(async () => {
    if (!protectedTabs.has(sourceId) || protectedTabs.has(targetId)) return;
    const target = await chrome.tabs.get(targetId).catch(() => null);
    if (!target) return;
    if (target.url === rootUrl + 'home.html' || target.pendingUrl === rootUrl + 'home.html') return;
    await chrome.tabs.remove(targetId).catch(() => {});
  }).catch(report);
}
chrome.tabs.onCreated.addListener(tab => {
  if (tab.openerTabId !== undefined) closePopup(tab.openerTabId, tab.id);
});
chrome.webNavigation.onCreatedNavigationTarget.addListener(event => closePopup(event.sourceTabId, event.tabId));
chrome.webNavigation.onCommitted.addListener(event => {
  serial(async () => {
    if (!protectedTabs.has(event.tabId) || !event.url.startsWith('https://')) return;
    await chrome.scripting.executeScript({target: {tabId: event.tabId, frameIds: [event.frameId]}, world: 'MAIN', func: () => {
      try { Object.defineProperty(window, 'open', {value: () => null, writable: false, configurable: false}); } catch {}
    }}).catch(() => {});
  }).catch(report);
});
chrome.runtime.onInstalled.addListener(() => { serial(home).catch(report); });
chrome.runtime.onStartup.addListener(() => { ready.catch(report); });
ready.catch(report);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.audioAssist) audioAssistEnabled = changes.audioAssist.newValue === true;
});
