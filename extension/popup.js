import {parseAllowedUrl} from './policy.js';
const $ = (selector) => document.querySelector(selector);
let currentTab = null; let protectedTabs = []; let bookmarks = [];
function send(type, payload = {}) { return new Promise((resolve) => chrome.runtime.sendMessage({ type, ...payload }, (response) => resolve(chrome.runtime.lastError ? { ok:false, error:chrome.runtime.lastError.message } : response && typeof response.ok === "boolean" ? response : { ok:false, error:"応答を確認できませんでした。" }))); }
function status(message = "", error = false) { const node = $("#popup-status"); node.textContent = message; node.classList.toggle("error", error); }
function pending(button, active) { button.disabled = active; }
function validPage(tab) { return Boolean(tab && parseAllowedUrl(tab.url)); }
async function refresh() {
  const [tabs] = await Promise.all([chrome.tabs.query({ active: true, currentWindow: true })]); currentTab = tabs[0] || null;
  const state = await send("state"); protectedTabs = state.ok ? state.data?.tabs || [] : []; bookmarks = state.ok ? state.data?.bookmarks || [] : [];
  const safe = Boolean(currentTab && protectedTabs.some((tab) => tab.id === currentTab.id));
  const badge = $("#safe-badge"); badge.textContent = safe ? "SAFE" : "通常のタブ"; badge.classList.toggle("off", !safe);
  $("#current-title").textContent = currentTab?.title || "タブを確認できませんでした";
  $("#current-url").textContent = currentTab?.url || "";
  const bookmark = $("#bookmark-button"); const saved = validPage(currentTab) && bookmarks.some((item) => item.url === parseAllowedUrl(currentTab.url)); bookmark.disabled = !validPage(currentTab); bookmark.textContent = saved ? "ブックマークから削除" : "ブックマークに保存"; bookmark.dataset.saved = String(saved);
  if (!state.ok) status(state.error || "状態を取得できませんでした。", true);
}
$("#bookmark-button").addEventListener("click", async () => { if (!validPage(currentTab)) return; const button = $("#bookmark-button"); pending(button, true); const saved = button.dataset.saved === "true"; const result = await send(saved ? "bookmark-remove" : "bookmark-add", saved ? { url: parseAllowedUrl(currentTab.url) } : { url: currentTab.url, title: currentTab.title || "" }); status(result.ok ? (saved ? "ブックマークから削除しました。" : "ブックマークに保存しました。") : result.error || (saved ? "削除できませんでした。" : "保存できませんでした。"), !result.ok); await refresh(); });
$("#popup-open-form").addEventListener("submit", async (event) => { event.preventDefault(); const button = $("#popup-open-button"); pending(button, true); const result = await send("open", { url: $("#popup-url-input").value.trim() }); if (result.ok) { $("#popup-url-input").value = ""; status("専用タブで開きました。"); } else status(result.error || "このURLは開けませんでした。", true); pending(button, false); refresh(); });
$("#home-button").addEventListener("click", async () => { const button = $("#home-button"); pending(button, true); const result = await send("home"); if (!result.ok) { status(result.error || "ホームを開けませんでした。", true); pending(button, false); } });
chrome.storage.onChanged.addListener(refresh); refresh();
