(() => {
  'use strict';

  let enabled = false;
  let protectedPage = false;
  let interacted = false;
  const handledSources = new WeakMap();

  const isExcludedHost = () => {
    const host = location.hostname.toLowerCase();
    return host === 't.co' || host === 'x.com' || host.endsWith('.x.com');
  };

  const sourceKey = (video) => {
    if (video.srcObject) return video.srcObject;
    return video.currentSrc || video.src || '';
  };

  const hasGenuineInteraction = () => interacted;

  const isVisiblePlayingVideo = (video) => {
    if (!(video instanceof HTMLVideoElement) || video.paused || video.ended) return false;
    if (video.volume <= 0 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;

    for (let node = video; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    }

    const rect = video.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 &&
      rect.right > 0 && rect.bottom > 0 &&
      rect.left < innerWidth && rect.top < innerHeight;
  };

  const sourceAlreadyHandled = (video) => {
    const source = sourceKey(video);
    return handledSources.get(video) === source;
  };

  const markHandled = (video) => handledSources.set(video, sourceKey(video));

  const chooseVideo = (preferred) => {
    const candidates = [...document.querySelectorAll('video')].filter(isVisiblePlayingVideo);
    // Avoid enabling a second soundtrack beside a video already playing aloud.
    if (isVisiblePlayingVideo(preferred)) {
      if (candidates.some(video => video !== preferred && !video.muted)) return null;
      return preferred;
    }
    return candidates.length === 1 ? candidates[0] : null;
  };

  const assist = (preferred) => {
    if (!protectedPage || !enabled || isExcludedHost() || document.visibilityState !== 'visible' || !hasGenuineInteraction()) return;

    const video = chooseVideo(preferred);
    if (!video || sourceAlreadyHandled(video)) return;

    // One best-effort unmute after a real page interaction; site/manual remutes win.
    if (!video.muted) {
      markHandled(video);
      return;
    }
    video.muted = false;
    if (!video.muted) markHandled(video);
  };

  const recordInteraction = (event) => {
    if (!event.isTrusted) return;
    interacted = true;
    // Capture the pre-click state so a first click on a mute control is respected.
    if (protectedPage && enabled) {
      for (const video of document.querySelectorAll('video')) {
        if (isVisiblePlayingVideo(video) && !video.muted) markHandled(video);
      }
    }

    const target = event.target;
    const preferred = target instanceof HTMLVideoElement ? target : target && target.closest && target.closest('video');
    // Let site/native controls finish toggling before applying assistance.
    setTimeout(() => assist(preferred), 0);
  };

  document.addEventListener('click', recordInteraction, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') recordInteraction(event);
  }, true);
  document.addEventListener('playing', () => assist(null), true);

  chrome.runtime.sendMessage({ type: 'is-protected' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok || !response.data || !response.data.protected) return;
    protectedPage = true;
    enabled = response.data.audioAssist === true;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (protectedPage && areaName === 'local' && changes.audioAssist) enabled = changes.audioAssist.newValue === true;
  });
})();
