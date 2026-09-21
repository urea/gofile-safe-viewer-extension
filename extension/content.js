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
    // Reuse the same URL patterns as the network rules. Cancel navigation before
    // the document is replaced; DNR still blocks requests this guard cannot catch.
    const navigationPatterns = response.data.navigationPatterns.map(pattern => new RegExp(pattern, 'i'));
    function allowedDestination(value) {
      try {
        const url = new URL(value, location.href);
        return url.protocol === 'https:' && !url.username && !url.password
          && navigationPatterns.some(pattern => pattern.test(url.href.split('#')[0]));
      } catch { return false; }
    }
    window.navigation?.addEventListener('navigate', event => {
      if (!event.cancelable || allowedDestination(event.destination.url)) return;
      event.preventDefault();
      tell('許可対象外への移動を止めました。');
    });
    function intercept(event) {
      const anchor = event.composedPath().find(node => node instanceof HTMLAnchorElement);
      if (!anchor) return;
      const href = anchor.href;
      const stop = () => { event.preventDefault(); event.stopImmediatePropagation(); };
      if (anchor.hasAttribute('download')) { stop(); tell('この閲覧タブではダウンロードを抑制しています。'); return; }
      if (!/^https:\/\//i.test(href)) {
        stop(); tell('HTTPS以外のリンクは開けません。'); return;
      }
      if (!allowedDestination(href)) {
        stop(); tell('許可対象外への移動を止めました。'); return;
      }
      const target = anchor.target || document.querySelector('base[target]')?.target;
      const middleClick = event.type === 'auxclick' && event.button === 1;
      const modifiedPrimaryClick = event.type === 'click' && event.button === 0 && (event.ctrlKey || event.metaKey);
      if ((target && target.toLowerCase() !== '_self') || event.ctrlKey || event.metaKey || event.shiftKey || event.type === 'auxclick') {
        stop();
        if (event.type === 'auxclick' && event.button !== 1) return;
        if (!event.isTrusted) return;
        chrome.runtime.sendMessage({type: 'navigate', url: href, openInBackground: middleClick || modifiedPrimaryClick}).then(result => {
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
