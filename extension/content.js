(() => {
  chrome.runtime.sendMessage({type: 'is-protected'}).then(response => {
    if (!response?.ok || !response.data.protected) return;
    const style = document.createElement('style');
    style.textContent = '.video-float-ad,[class*="float-ad"],[id*="float-ad"]{display:none!important;visibility:hidden!important;pointer-events:none!important}';
    const appendStyle = () => { if (document.documentElement) document.documentElement.append(style); };
    if (document.documentElement) appendStyle();
    else document.addEventListener('DOMContentLoaded', appendStyle, {once: true});
    let notice;
    const tell = text => {
      if (!document.documentElement) return;
      if (!notice) {
        notice = document.createElement('div');
        notice.setAttribute('role', 'status');
        notice.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:2147483647;padding:12px 18px;border-radius:12px;background:#173c35;color:white;font:14px system-ui;box-shadow:0 4px 24px #0004;pointer-events:none;max-width:80vw';
        document.documentElement.append(notice);
      }
      notice.textContent = text;
      clearTimeout(tell.timer);
      tell.timer = setTimeout(() => { notice.remove(); notice = null; }, 3500);
    };
    function intercept(event) {
      const anchor = event.composedPath().find(node => node instanceof HTMLAnchorElement);
      if (!anchor) return;
      const href = anchor.href;
      const stop = () => { event.preventDefault(); event.stopImmediatePropagation(); };
      if (anchor.hasAttribute('download')) { stop(); tell('この閲覧タブではダウンロードを抑制しています。'); return; }
      if (!/^https:\/\//i.test(href)) {
        stop(); tell('HTTPS以外のリンクは開けません。'); return;
      }
      if (anchor.target && anchor.target.toLowerCase() !== '_self' || event.ctrlKey || event.metaKey || event.shiftKey || event.type === 'auxclick') {
        stop();
        if (event.type === 'auxclick' && event.button !== 1) return;
        if (!event.isTrusted) return;
        chrome.runtime.sendMessage({type: 'navigate', url: href}).then(result => {
          if (!result?.ok) tell(result?.error || 'リンクを開けませんでした。');
        }).catch(() => {});
      }
    }
    document.addEventListener('click', intercept, true);
    document.addEventListener('auxclick', intercept, true);
    document.addEventListener('submit', event => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!/^https:\/\//i.test(form.action)) { event.preventDefault(); event.stopImmediatePropagation(); tell('HTTPS以外への送信はできません。'); }
      else if (form.target && form.target !== '_self') form.target = '_self';
    }, true);
  }).catch(() => {});
})();
