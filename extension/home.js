const $ = (selector) => document.querySelector(selector);
let state = { tabs: [], bookmarks: [] };
let isRendering = false;

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
      resolve(response && typeof response.ok === "boolean" ? response : { ok: false, error: "応答を確認できませんでした。" });
    });
  });
}
function setStatus(message = "", error = false) { const target = $("#open-status"); target.textContent = message; target.classList.toggle("error", error); }
function setPending(button, pending) { button.disabled = pending; }
function displayUrl(url) { try { return new URL(url).hostname + new URL(url).pathname; } catch { return url; } }
function makeItem({ title, url }, { onOpen, onSave, onRemove, label }) {
  const li = document.createElement("li"); li.className = "item";
  const main = document.createElement("button"); main.type = "button"; main.className = "item-main"; main.title = url;
  const name = document.createElement("span"); name.className = "item-title"; name.textContent = title || displayUrl(url);
  const address = document.createElement("span"); address.className = "item-url"; address.textContent = displayUrl(url);
  main.append(name, address); main.addEventListener("click", async () => { main.disabled = true; await onOpen(); main.disabled = false; });
  li.append(main);
  if (onSave) { const save = document.createElement("button"); save.type = "button"; save.className = "mini-button"; save.textContent = "保存"; save.addEventListener("click", async () => { save.disabled = true; await onSave(); save.disabled = false; }); li.append(save); }
  if (onRemove) { const remove = document.createElement("button"); remove.type = "button"; remove.className = "icon-button"; remove.title = label; remove.setAttribute("aria-label", label); remove.textContent = "×"; remove.addEventListener("click", async () => { remove.disabled = true; await onRemove(); remove.disabled = false; }); li.append(remove); }
  return li;
}
async function refresh() { const result = await send("state"); if (!result.ok) return setStatus(result.error || "状態を取得できませんでした。", true); state = { tabs: result.data?.tabs || [], bookmarks: result.data?.bookmarks || [] }; $("#audio-assist-toggle").checked = result.data?.audioAssist === true; render(); }
function render() {
  if (isRendering) return; isRendering = true;
  const query = $("#bookmark-search").value.trim().toLowerCase();
  const bookmarks = state.bookmarks.filter(({ url, title }) => `${url} ${title || ""}`.toLowerCase().includes(query));
  const bookmarkList = $("#bookmarks-list"); bookmarkList.replaceChildren();
  bookmarks.forEach((bookmark) => bookmarkList.append(makeItem(bookmark, { label: "ブックマークを削除", onOpen: () => openUrl(bookmark.url), onRemove: async () => { const result = await send("bookmark-remove", { url: bookmark.url }); if (!result.ok) return setStatus(result.error || "削除できませんでした。", true); setStatus("ブックマークを削除しました。"); refresh(); } })));
  $("#bookmarks-empty").hidden = state.bookmarks.length > 0;
  $("#bookmarks-no-results").hidden = !(state.bookmarks.length > 0 && bookmarks.length === 0);
  $("#clear-bookmarks").hidden = state.bookmarks.length === 0;
  const tabList = $("#tabs-list"); tabList.replaceChildren();
  state.tabs.forEach((tab) => tabList.append(makeItem(tab, { label: "タブを閉じる", onOpen: async () => { const result = await send("focus", { tabId: tab.id }); if (!result.ok) return setStatus(result.error || "タブを表示できませんでした。", true); await refresh(); }, onSave: async () => { const result = await send("bookmark-add", { url: tab.url, title: tab.title }); if (!result.ok) return setStatus(result.error || "保存できませんでした。", true); setStatus("ブックマークに保存しました。"); await refresh(); }, onRemove: async () => { const result = await send("close", { tabId: tab.id }); if (!result.ok) return setStatus(result.error || "タブを閉じられませんでした。", true); setStatus("タブを閉じました。"); await refresh(); } })));
  $("#tabs-empty").hidden = state.tabs.length > 0; $("#tab-count").textContent = String(state.tabs.length);
  isRendering = false;
}
async function openUrl(url) {
  const result = await send("open", { url });
  if (!result.ok) return setStatus(result.error || "このURLは開けませんでした。", true);
  $("#url-input").value = ""; setStatus("専用タブで開きました。"); refresh();
}
$("#open-form").addEventListener("submit", async (event) => { event.preventDefault(); const button = $("#open-button"); setPending(button, true); await openUrl($("#url-input").value.trim()); setPending(button, false); });
$("#open-x-button").addEventListener("click", async () => { const button = $("#open-x-button"); setPending(button, true); await openUrl("https://x.com/home"); setPending(button, false); });
$("#bookmark-search").addEventListener("input", render);
$("#clear-bookmarks").addEventListener("click", async () => { if (!window.confirm("保存したブックマークをすべて消去しますか？")) return; const button = $("#clear-bookmarks"); setPending(button, true); const result = await send("bookmarks-clear"); if (!result.ok) setStatus(result.error || "消去できませんでした。", true); else { setStatus("ブックマークをすべて消去しました。"); await refresh(); } setPending(button, false); });
chrome.storage.onChanged.addListener(() => refresh());
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
refresh();

$("#audio-assist-toggle").addEventListener("change", async () => {
  const toggle = $("#audio-assist-toggle"); toggle.disabled = true;
  const result = await send("audio-assist-set", { enabled: toggle.checked });
  setStatus(result.ok ? "音声補助の設定を保存しました。" : result.error || "設定を保存できませんでした。", !result.ok);
  await refresh(); toggle.disabled = false;
});
