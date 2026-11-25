(() => {
  'use strict';

  if (window.__abfDomSkipperInstalled) return;
  window.__abfDomSkipperInstalled = true;

  const DEFAULT_CONFIG = {
    enabled: true,
    disabledHosts: [],
    skipVideoAds: true,
    muteDuringAds: true,
    playbackSpeed: 16,
    blockVast: true,
    blockPopunder: true,
    removeOverlays: true,
    showToast: true,
  };

  let config = { ...DEFAULT_CONFIG };
  let tabHost = location.hostname.toLowerCase();
  let effectiveEnabled = true;

  const videoStateMap = new WeakMap();
  const skipClickCooldown = new WeakMap();
  let pendingStats = Object.create(null);
  let statsTimer = null;
  let scanIntervalId = null;
  let toastEl = null;
  let toastHideTimer = null;

  const AD_VIDEO_URL_RE =
    /(doubleclick\.net|googlesyndication\.com|googleadservices\.com|an\.yandex\.ru|adfox|videonow\.ru|nativeroll\.tv|buzzoola\.com|betweendigital\.com|adriver\.ru|ad\.mail\.ru|innovid\.com|springserve\.com|spotx|2mdn\.net|\/(preroll|midroll|postroll|vast)\/)/i;

  const AD_VIDEO_ATTR_RE = /(^|[-_])(preroll|midroll|postroll|ad-?video|vast-?video)([-_]|$)/i;

  const SKIP_BUTTON_SELECTORS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container button',
    '.ytp-ad-skip-button-slot button',
    'button[id^="skip-button"]',
    '.jw-skip',
    '.vjs-vast-skip-button',
    '.vjs-ad-skip',
    '.ima-ad-skip-button',
    '.videoAdUiSkipButton',
    '[class*="skip-ad"]',
    '[class*="skip_ad"]',
    '[class*="ad-skip"]',
    '[class*="ad_skip"]',
    '[data-testid*="skip-ad"]',
    '[data-action="skip-ad"]',
    '.skip-ads',
    '.skipAd',
  ].join(',');

  const EXCLUDE_SKIP_TEXT_RE =
    /(заставк|титр|интро|сери[яию]|следующ|intro|recap|credits|next\s*episode|up\s*next)/i;
  const POSITIVE_SKIP_TEXT_RE =
    /^(пропустить(\s+рекламу)?|skip(\s+ads?)?|закрыть\s+рекламу|close\s+ad)$/i;
  const WAIT_COUNTDOWN_RE = /(через\s*\d|in\s+\d+\s*(s|sec)|осталось\s*\d)/i;

  const AD_BADGE_TEXT_RE =
    /^((реклама|advertisement|sponsored)(\s*[·•:\-|\d]|$)|до\s+конца\s+рекламы|пропустить\s+(рекламу|через\s*\d+)|skip\s+(ad|ads|in\s+\d+)|ad\s+\d+\s+of\s+\d+)/i;

  const AD_OVERLAY_ATTR_RE =
    /(^|[-_])(ad|ads|adv|adblock|banner|pauseroll|preroll|popunder|clickunder|vast|promo)([-_]|$)/i;

  function normalizeHost(host) {
    return String(host || '')
      .toLowerCase()
      .replace(/^www\./, '');
  }

  function isHostDisabled(host, disabledList) {
    const clean = normalizeHost(host);
    if (!clean || !Array.isArray(disabledList)) return false;
    return disabledList.some((d) => {
      const target = normalizeHost(d);
      return clean === target || clean.endsWith('.' + target);
    });
  }

  function computeEffectiveEnabled() {
    if (!config.enabled) return false;
    if (isHostDisabled(tabHost, config.disabledHosts)) return false;
    if (isHostDisabled(location.hostname, config.disabledHosts)) return false;
    return true;
  }

  function restoreAllVideosIfSaved() {
    document.querySelectorAll('video').forEach((video) => {
      const saved = videoStateMap.get(video);
      if (!saved) return;
      try {
        video.muted = saved.muted;
        const safeRate =
          Number.isFinite(saved.playbackRate) && saved.playbackRate >= 0.25 && saved.playbackRate <= 4
            ? saved.playbackRate
            : 1;
        video.playbackRate = safeRate;
      } catch (_) {}
      videoStateMap.delete(video);
    });
  }

  function syncStateToPage() {
    effectiveEnabled = computeEffectiveEnabled();
    if (!effectiveEnabled || !config.skipVideoAds) {
      restoreAllVideosIfSaved();
    }
    const root = document.documentElement;
    if (root) {
      if (effectiveEnabled) {
        root.removeAttribute('data-abf-disabled');
      } else {
        root.setAttribute('data-abf-disabled', '1');
      }
      const payload = {
        enabled: effectiveEnabled,
        blockVast: !!config.blockVast,
        blockPopunder: !!config.blockPopunder,
      };
      try {
        root.dataset.abfConfig = JSON.stringify(payload);
      } catch (_) {}
      window.dispatchEvent(new CustomEvent('__ABF_CONFIG__', { detail: payload }));
    }
    updateScannerSchedule();
  }

  function queueBlockedStat(kind, count = 1) {
    if (!effectiveEnabled || !count) return;
    pendingStats[kind] = (pendingStats[kind] || 0) + count;
    if (!statsTimer) {
      statsTimer = setTimeout(() => {
        const batch = pendingStats;
        pendingStats = Object.create(null);
        statsTimer = null;
        try {
          chrome.runtime.sendMessage({ type: 'AD_BLOCKED_BATCH', batch }).catch(() => {});
        } catch (_) {}
      }, 350);
    }
  }

  window.addEventListener('__ABF_BLOCKED__', (ev) => {
    const detail = ev?.detail;
    if (!detail || !detail.kind) return;
    queueBlockedStat(detail.kind, Number(detail.count) || 1);
    if (detail.kind === 'vast' && config.showToast && window === window.top) {
      showSkipToast('Реклама удалена');
    }
  });

  function showSkipToast(message) {
    if (!config.showToast || !document.body) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'abf-skip-toast';
      const dot = document.createElement('span');
      dot.className = 'abf-skip-toast-dot';
      const label = document.createElement('span');
      label.className = 'abf-skip-toast-text';
      toastEl.append(dot, label);
      document.body.appendChild(toastEl);
    }
    const textNode = toastEl.querySelector('.abf-skip-toast-text');
    if (textNode) textNode.textContent = `${message} · AdBlockFilms`;
    toastEl.classList.add('abf-visible');
    clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => {
      toastEl?.classList.remove('abf-visible');
    }, 1800);
  }

  function isElementVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 4 && rect.height > 4;
  }

  function findPlayerContainer(video) {
    let cur = video.parentElement;
    let best = video.parentElement || document.body;
    for (let i = 0; i < 6 && cur && cur !== document.body && cur !== document.documentElement; i++) {
      if (
        cur.matches(
          '.html5-video-player, .video-js, .jwplayer, .plyr, [class*="player"], [id*="player"], [class*="video-container"]'
        )
      ) {
        return cur;
      }
      best = cur;
      cur = cur.parentElement;
    }
    return best;
  }

  function hasAdBadgeInPlayer(video, container) {
    if (!container) return false;
    const videoRect = video.getBoundingClientRect();
    if (videoRect.width < 120 || videoRect.height < 80) return false;

    const candidates = container.querySelectorAll('div, span, p, button, a');
    const limit = Math.min(candidates.length, 60);
    for (let i = 0; i < limit; i++) {
      const el = candidates[i];
      if (el.children.length > 2) continue;
      if (el.closest('[class*="subtitle"], [class*="caption"], .ytp-caption-window-container')) continue;
      const text = (el.textContent || '').trim();
      if (!text || text.length > 48) continue;
      if (!AD_BADGE_TEXT_RE.test(text)) continue;
      if (!isElementVisible(el)) continue;

      const r = el.getBoundingClientRect();
      const overlapsVideo =
        r.right >= videoRect.left &&
        r.left <= videoRect.right &&
        r.bottom >= videoRect.top &&
        r.top <= videoRect.bottom;
      if (overlapsVideo && r.height <= 90 && r.width <= videoRect.width * 0.75) {
        return true;
      }
    }
    return false;
  }

  function detectVideoAd(video) {
    if (!video || !video.isConnected) {
      return { isAd: false, authoritative: false, reason: '' };
    }

    // 1. Authoritative platform/player flags
    const ytPlayer = video.closest('.html5-video-player');
    if (ytPlayer && (ytPlayer.classList.contains('ad-showing') || ytPlayer.classList.contains('ad-interrupting'))) {
      return { isAd: true, authoritative: true, reason: 'youtube' };
    }

    const vjsPlayer = video.closest('.video-js');
    if (vjsPlayer && (vjsPlayer.classList.contains('vjs-ad-playing') || vjsPlayer.classList.contains('vjs-ad-loading'))) {
      return { isAd: true, authoritative: true, reason: 'videojs' };
    }

    const jwPlayer = video.closest('.jwplayer');
    if (jwPlayer && jwPlayer.classList.contains('jw-flag-ads')) {
      return { isAd: true, authoritative: true, reason: 'jwplayer' };
    }

    if (video.closest('[data-is-ad="true"], .is-ad-playing, .ad-playing')) {
      return { isAd: true, authoritative: true, reason: 'player-flag' };
    }

    // 2. Video source / element attributes
    const src = video.currentSrc || video.src || '';
    if (src && AD_VIDEO_URL_RE.test(src)) {
      return { isAd: true, authoritative: false, reason: 'ad-src' };
    }
    const idClass = `${video.id || ''} ${typeof video.className === 'string' ? video.className : ''}`;
    if (AD_VIDEO_ATTR_RE.test(idClass)) {
      return { isAd: true, authoritative: false, reason: 'ad-attr' };
    }

    // 3. Visual ad badge / countdown inside player container
    const container = findPlayerContainer(video);
    if (hasAdBadgeInPlayer(video, container)) {
      return { isAd: true, authoritative: false, reason: 'ad-badge' };
    }

    return { isAd: false, authoritative: false, reason: '' };
  }

  function isKnownExternalAdLink(el) {
    const anchor = el.tagName === 'A' ? el : el.closest('a');
    if (!anchor || !anchor.href) return false;
    try {
      const u = new URL(anchor.href, location.href);
      if (u.hostname && u.hostname !== location.hostname) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  function clickElementSafely(el) {
    const now = Date.now();
    const last = skipClickCooldown.get(el) || 0;
    if (now - last < 650) return false;
    skipClickCooldown.set(el, now);

    try {
      el.focus?.({ preventScroll: true });
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      el.click();
      return true;
    } catch (_) {
      return false;
    }
  }

  function tryClickSkipButtons(root = document) {
    let clicked = false;
    const candidates = new Set();

    try {
      root.querySelectorAll(SKIP_BUTTON_SELECTORS).forEach((el) => candidates.add(el));
    } catch (_) {}

    const genericControls = root.querySelectorAll('button, [role="button"], [class*="skip"], [id*="skip"]');
    const maxScan = Math.min(genericControls.length, 80);
    for (let i = 0; i < maxScan; i++) {
      candidates.add(genericControls[i]);
    }

    for (const el of candidates) {
      if (!isElementVisible(el)) continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      if (window.getComputedStyle(el).pointerEvents === 'none') continue;
      if (isKnownExternalAdLink(el)) continue;

      const label = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.trim();
      if (EXCLUDE_SKIP_TEXT_RE.test(label)) continue;

      const matchesSelector = el.matches?.(SKIP_BUTTON_SELECTORS);
      const matchesText = POSITIVE_SKIP_TEXT_RE.test(label);

      if ((matchesSelector && !WAIT_COUNTDOWN_RE.test(label)) || matchesText) {
        if (clickElementSafely(el)) {
          clicked = true;
          queueBlockedStat('video', 1);
          showSkipToast('Реклама пропущена');
        }
      }
    }
    return clicked;
  }

  function handleVideoElement(video) {
    const detection = detectVideoAd(video);
    let saved = videoStateMap.get(video);

    if (detection.isAd) {
      if (!saved) {
        saved = {
          muted: video.muted,
          playbackRate: video.playbackRate || 1,
          reported: false,
          seekAttempts: 0,
        };
        videoStateMap.set(video, saved);
      }

      if (config.muteDuringAds && !video.muted) {
        video.muted = true;
      }

      const maxDuration = detection.authoritative ? 7200 : 240;
      const dur = video.duration;
      if (Number.isFinite(dur) && dur > 0.4 && dur <= maxDuration) {
        const targetRate = Math.max(1, Math.min(Number(config.playbackSpeed) || 16, 16));
        if (video.playbackRate !== targetRate) {
          try {
            video.playbackRate = targetRate;
          } catch (_) {
            try {
              video.playbackRate = 4;
            } catch (_) {}
          }
        }
        if (video.currentTime < dur - 0.3 && saved.seekAttempts < 4) {
          try {
            video.currentTime = Math.max(0, dur - 0.12);
            saved.seekAttempts += 1;
          } catch (_) {}
        }
      }

      if (video.paused && !video.ended) {
        video.play().catch(() => {});
      }

      if (!saved.reported) {
        saved.reported = true;
        queueBlockedStat('video', 1);
        showSkipToast('Реклама пропущена');
      }

      const container = findPlayerContainer(video);
      tryClickSkipButtons(container || document);
    } else if (saved) {
      // Ad finished: restore original playback settings
      try {
        video.muted = saved.muted;
        const safeRate =
          Number.isFinite(saved.playbackRate) && saved.playbackRate >= 0.25 && saved.playbackRate <= 4
            ? saved.playbackRate
            : 1;
        video.playbackRate = safeRate;
      } catch (_) {}
      videoStateMap.delete(video);
    }
  }

  function cleanOverlayShields(videos) {
    if (!config.removeOverlays || videos.length === 0) return;

    for (const video of videos) {
      const vRect = video.getBoundingClientRect();
      if (vRect.width < 150 || vRect.height < 90) continue;
      const container = findPlayerContainer(video);
      if (!container) continue;

      const overlays = container.querySelectorAll('a, div, iframe, span');
      const limit = Math.min(overlays.length, 60);
      for (let i = 0; i < limit; i++) {
        const el = overlays[i];
        if (el === video || el.contains(video)) continue;
        if (!isElementVisible(el)) continue;

        const r = el.getBoundingClientRect();
        const coversMost = r.width >= vRect.width * 0.45 && r.height >= vRect.height * 0.45;
        if (!coversMost) continue;

        const idClass = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
        const hasAdAttr = AD_OVERLAY_ATTR_RE.test(idClass);
        const isExternalAnchor = el.tagName === 'A' && isKnownExternalAdLink(el);
        const hasControls = el.querySelector('button, input[type="range"], [role="slider"], [class*="control"]');

        if ((isExternalAnchor || (hasAdAttr && !hasControls))) {
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
          queueBlockedStat('overlay', 1);
        }
      }
    }
  }

  function runScanCycle() {
    if (!effectiveEnabled) return;
    if (document.hidden) return;

    const videos = document.querySelectorAll('video');
    if (config.skipVideoAds) {
      for (const video of videos) {
        handleVideoElement(video);
      }
      if (videos.length > 0 || document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .jw-skip, .vjs-ad-skip')) {
        tryClickSkipButtons(document);
      }
    }

    if (videos.length > 0) {
      cleanOverlayShields(videos);
    }
  }

  function updateScannerSchedule() {
    if (!effectiveEnabled) {
      if (scanIntervalId) {
        clearInterval(scanIntervalId);
        scanIntervalId = null;
      }
      return;
    }

    const hasMedia = document.querySelector('video, .html5-video-player, .video-js, .jwplayer') !== null;
    const desiredDelay = hasMedia ? 180 : 1200;

    if (scanIntervalId) {
      clearInterval(scanIntervalId);
    }
    scanIntervalId = setInterval(runScanCycle, desiredDelay);
    runScanCycle();
  }

  function startObservers() {
    const observer = new MutationObserver((mutations) => {
      if (!effectiveEnabled) return;
      let sawVideoOrAd = false;
      for (const m of mutations) {
        if (m.type === 'attributes' && m.target instanceof Element) {
          if (m.target.matches('.html5-video-player, .video-js, .jwplayer, video')) {
            sawVideoOrAd = true;
            break;
          }
        }
        if (m.addedNodes.length > 0) {
          for (const node of m.addedNodes) {
            if (node instanceof Element && (node.tagName === 'VIDEO' || node.querySelector?.('video, [class*="skip"], [class*="ad"]'))) {
              sawVideoOrAd = true;
              break;
            }
          }
        }
        if (sawVideoOrAd) break;
      }
      if (sawVideoOrAd) {
        runScanCycle();
      }
    });

    const target = document.documentElement || document;
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'src', 'style', 'data-is-ad'],
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && effectiveEnabled) {
        runScanCycle();
      }
    });

    document.addEventListener(
      'loadedmetadata',
      (ev) => {
        if (ev.target instanceof HTMLVideoElement && effectiveEnabled) {
          handleVideoElement(ev.target);
          updateScannerSchedule();
        }
      },
      true
    );
  }

  async function initConfig() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_TAB_CONFIG' });
      if (resp && resp.settings) {
        config = { ...DEFAULT_CONFIG, ...resp.settings };
        if (resp.tabHost) tabHost = resp.tabHost;
      }
    } catch (_) {
      try {
        const stored = await chrome.storage.local.get('settings');
        if (stored?.settings) {
          config = { ...DEFAULT_CONFIG, ...stored.settings };
        }
      } catch (_) {}
    }
    syncStateToPage();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'CONFIG_UPDATED' && msg.settings) {
      config = { ...DEFAULT_CONFIG, ...msg.settings };
      if (msg.tabHost) tabHost = msg.tabHost;
      syncStateToPage();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings?.newValue) {
      config = { ...DEFAULT_CONFIG, ...changes.settings.newValue };
      syncStateToPage();
    }
  });

  syncStateToPage();
  startObservers();
  initConfig();
})();
