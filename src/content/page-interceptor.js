(() => {
  'use strict';

  if (window.__abfPageInterceptorInstalled) return;
  window.__abfPageInterceptorInstalled = true;

  const EMPTY_VAST_XML = '<?xml version="1.0" encoding="UTF-8"?><VAST version="3.0"></VAST>';
  const EMPTY_VMAP_XML =
    '<?xml version="1.0" encoding="UTF-8"?><vmap:VMAP xmlns:vmap="http://www.iab.net/videosuite/vmap" version="1.0"></vmap:VMAP>';

  const state = {
    enabled: true,
    blockVast: true,
    blockPopunder: true,
    lastPlayerClickAt: 0,
  };

  try {
    const raw = document.documentElement?.dataset?.abfConfig;
    if (raw) {
      Object.assign(state, JSON.parse(raw));
    }
  } catch (_) {}

  window.addEventListener('__ABF_CONFIG__', (ev) => {
    if (ev && ev.detail && typeof ev.detail === 'object') {
      Object.assign(state, ev.detail);
    }
  });

  function reportBlocked(kind, count = 1) {
    try {
      window.dispatchEvent(
        new CustomEvent('__ABF_BLOCKED__', { detail: { kind, count } })
      );
    } catch (_) {}
  }

  const KNOWN_AD_HOSTS = [
    'doubleclick.net',
    'googlesyndication.com',
    'googleadservices.com',
    'adservice.google.com',
    'an.yandex.ru',
    'ads.adfox.ru',
    'adfox.yandex.ru',
    'adriver.ru',
    'videonow.ru',
    'nativeroll.tv',
    'buzzoola.com',
    'betweendigital.com',
    'ad.mail.ru',
    'rs.mail.ru',
    'target.my.com',
    'springserve.com',
    'spotxchange.com',
    'innovid.com',
    'freewheel.tv',
    'fwmrm.net',
    'exoclick.com',
    'popads.net',
    'popcash.net',
    'propellerads.com',
    'monetag.com',
    'adsterra.com',
    'highperformanceformat.com',
    'effectivegatecpm.com',
    'clickadu.com',
    'suprion.ru',
    'video-mech.ru',
    'bidster.net',
    'veonadx.com',
    'mplays.ru',
    'qtarget.tech',
    'rutarget.ru',
    'programmatica.com',
    'adlook.me',
    'adlook.tech',
  ];

  const YOUTUBE_HOST_RE = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i;
  const MEDIA_EXT_RE = /\.(mp4|m3u8|mpd|ts|webm|mkv|avi|mov)(\?|#|$)/i;
  const EXPLICIT_VAST_URL_RE =
    /(\/(vast|vmap|preroll|midroll|postroll|pauseroll)\.(xml|json)|[?&](ad_type|vast|vmap|gdfp_req|correlator)=)/i;
  const PLAYER_AD_KEYS = [
    'preroll',
    'midroll',
    'postroll',
    'pauseroll',
    'vast',
    'vast_url',
    'vastUrl',
    'vast_skip',
    'vmap',
    'vmap_url',
    'vmapUrl',
    'adBreaks',
    'ad_breaks',
  ];
  const YOUTUBE_AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];

  function getHost(urlStr) {
    try {
      return new URL(urlStr, location.href).hostname.toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function isKnownAdUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return false;
    const host = getHost(urlStr);
    if (host && KNOWN_AD_HOSTS.some((d) => host === d || host.endsWith('.' + d))) {
      return true;
    }
    if (!MEDIA_EXT_RE.test(urlStr) && EXPLICIT_VAST_URL_RE.test(urlStr)) {
      return true;
    }
    return false;
  }

  function looksLikeVastOrVmap(text) {
    if (typeof text !== 'string' || text.length < 10) return null;
    const trimmed = text.slice(0, 1200);
    if (/<vmap:VMAP\b/i.test(trimmed)) return 'vmap';
    if (/<VAST\b/i.test(trimmed) && (/<Ad\b/i.test(text) || /<VASTAdTagURI/i.test(text))) {
      return 'vast';
    }
    return null;
  }

  function isYouTubeHost() {
    return YOUTUBE_HOST_RE.test(location.hostname);
  }

  function cleanJsonPayload(obj, seen = new WeakSet()) {
    if (!obj || typeof obj !== 'object') return false;
    if (seen.has(obj)) return false;
    seen.add(obj);

    let modified = false;
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (cleanJsonPayload(obj[i], seen)) modified = true;
      }
      return modified;
    }

    const yt = isYouTubeHost();
    for (const key of Object.keys(obj)) {
      if (yt && YOUTUBE_AD_KEYS.includes(key)) {
        if (Array.isArray(obj[key]) && obj[key].length > 0) {
          obj[key] = [];
          modified = true;
        } else if (obj[key] && typeof obj[key] === 'object') {
          delete obj[key];
          modified = true;
        }
        continue;
      }

      if (PLAYER_AD_KEYS.includes(key)) {
        const val = obj[key];
        if (
          typeof val === 'string' &&
          (val.startsWith('http') ||
            val.startsWith('//') ||
            (val.startsWith('/') && val.length > 1) ||
            val.includes('<VAST') ||
            val.includes('vast'))
        ) {
          obj[key] = '';
          modified = true;
          continue;
        }
        if (Array.isArray(val) && val.length > 0) {
          obj[key] = [];
          modified = true;
          continue;
        }
      }

      if (obj[key] && typeof obj[key] === 'object') {
        if (cleanJsonPayload(obj[key], seen)) modified = true;
      }
    }
    return modified;
  }

  // 1. Intercept JSON.parse for YouTube & video player ad manifests
  const origJsonParse = JSON.parse;
  JSON.parse = function patchedJsonParse(text, reviver) {
    const res = origJsonParse.call(this, text, reviver);
    if (!state.enabled || !state.blockVast) return res;
    if (typeof text === 'string' && text.length > 28) {
      const hasAdMarker =
        text.includes('adPlacements') ||
        text.includes('playerAds') ||
        text.includes('adSlots') ||
        text.includes('preroll') ||
        text.includes('midroll') ||
        text.includes('vast');
      if (hasAdMarker && cleanJsonPayload(res)) {
        reportBlocked('vast', 1);
      }
    }
    return res;
  };

  // Protect window.ytInitialPlayerResponse on YouTube
  if (isYouTubeHost()) {
    let ytPlayerResp;
    try {
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        enumerable: true,
        get() {
          return ytPlayerResp;
        },
        set(val) {
          if (state.enabled && state.blockVast && val && typeof val === 'object') {
            if (cleanJsonPayload(val)) reportBlocked('vast', 1);
          }
          ytPlayerResp = val;
        },
      });
    } catch (_) {}
  }

  // 2. Intercept fetch() for VAST/VMAP XML & player ad JSON
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = async function patchedFetch(input, init) {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (state.enabled && state.blockVast && isKnownAdUrl(url)) {
        reportBlocked('vast', 1);
        const body = /vmap/i.test(url) ? EMPTY_VMAP_XML : EMPTY_VAST_XML;
        return new Response(body, {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/xml; charset=utf-8' },
        });
      }

      const response = await origFetch.apply(this, arguments);
      if (!state.enabled || !state.blockVast) return response;

      const contentType = (response.headers?.get('content-type') || '').toLowerCase();
      if (contentType.includes('xml') || contentType.includes('text/plain') || url.includes('vast') || url.includes('vmap')) {
        try {
          const clone = response.clone();
          const text = await clone.text();
          const kind = looksLikeVastOrVmap(text);
          if (kind) {
            reportBlocked('vast', 1);
            return new Response(kind === 'vmap' ? EMPTY_VMAP_XML : EMPTY_VAST_XML, {
              status: 200,
              statusText: 'OK',
              headers: { 'Content-Type': 'application/xml; charset=utf-8' },
            });
          }
        } catch (_) {}
      } else if (contentType.includes('json')) {
        try {
          const clone = response.clone();
          const text = await clone.text();
          if (
            text.includes('adPlacements') ||
            text.includes('playerAds') ||
            text.includes('adSlots') ||
            text.includes('preroll') ||
            text.includes('vast')
          ) {
            const parsed = origJsonParse(text);
            if (cleanJsonPayload(parsed)) {
              reportBlocked('vast', 1);
              return new Response(JSON.stringify(parsed), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            }
          }
        } catch (_) {}
      }

      return response;
    };
  }

  // 3. Intercept XMLHttpRequest for VAST/VMAP responses
  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedXhrOpen(method, url) {
    this.__abfUrl = typeof url === 'string' ? url : String(url || '');
    return origXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function patchedXhrSend() {
    const xhr = this;
    const url = xhr.__abfUrl || '';

    if (state.enabled && state.blockVast && isKnownAdUrl(url)) {
      reportBlocked('vast', 1);
      const emptyXml = /vmap/i.test(url) ? EMPTY_VMAP_XML : EMPTY_VAST_XML;
      try {
        const xmlDoc = new DOMParser().parseFromString(emptyXml, 'text/xml');
        Object.defineProperty(xhr, 'readyState', { configurable: true, get: () => 4 });
        Object.defineProperty(xhr, 'status', { configurable: true, get: () => 200 });
        Object.defineProperty(xhr, 'statusText', { configurable: true, get: () => 'OK' });
        Object.defineProperty(xhr, 'responseText', { configurable: true, get: () => emptyXml });
        Object.defineProperty(xhr, 'response', { configurable: true, get: () => emptyXml });
        Object.defineProperty(xhr, 'responseXML', { configurable: true, get: () => xmlDoc });
      } catch (_) {}
      setTimeout(() => {
        try {
          xhr.dispatchEvent(new Event('readystatechange'));
          xhr.dispatchEvent(new ProgressEvent('load'));
          xhr.dispatchEvent(new ProgressEvent('loadend'));
        } catch (_) {}
      }, 0);
      return;
    }

    xhr.addEventListener('readystatechange', function onReady() {
      if (xhr.readyState !== 4 || !state.enabled || !state.blockVast) return;
      try {
        if (xhr.responseType && xhr.responseType !== '' && xhr.responseType !== 'text' && xhr.responseType !== 'document') {
          return;
        }
        const text = typeof xhr.response === 'string' ? xhr.response : xhr.responseText;
        const kind = looksLikeVastOrVmap(text);
        if (kind) {
          reportBlocked('vast', 1);
          const emptyXml = kind === 'vmap' ? EMPTY_VMAP_XML : EMPTY_VAST_XML;
          const xmlDoc = new DOMParser().parseFromString(emptyXml, 'text/xml');
          Object.defineProperty(xhr, 'responseText', { configurable: true, get: () => emptyXml });
          Object.defineProperty(xhr, 'response', {
            configurable: true,
            get: () => (xhr.responseType === 'document' ? xmlDoc : emptyXml),
          });
          Object.defineProperty(xhr, 'responseXML', { configurable: true, get: () => xmlDoc });
        }
      } catch (_) {}
    });

    return origXhrSend.apply(this, arguments);
  };

  // 4. Hook common movie-site video player constructors (Playerjs, JWPlayer, Video.js)
  function stripPlayerjsConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return cfg;
    const adFields = ['preroll', 'midroll', 'postroll', 'pauseroll', 'vast', 'vast_skip', 'vast_timeout', 'ads', 'ad'];
    let hit = false;
    for (const f of adFields) {
      if (cfg[f]) {
        delete cfg[f];
        hit = true;
      }
    }
    if (hit) reportBlocked('vast', 1);
    return cfg;
  }

  let realPlayerjs;
  try {
    Object.defineProperty(window, 'Playerjs', {
      configurable: true,
      enumerable: true,
      get() {
        return realPlayerjs;
      },
      set(fn) {
        if (typeof fn !== 'function') {
          realPlayerjs = fn;
          return;
        }
        const wrapped = function PlayerjsWrapped(cfg) {
          if (state.enabled && state.blockVast && cfg && typeof cfg === 'object') {
            stripPlayerjsConfig(cfg);
          }
          return new.target ? new fn(cfg) : fn.apply(this, arguments);
        };
        wrapped.prototype = fn.prototype;
        Object.assign(wrapped, fn);
        realPlayerjs = wrapped;
      },
    });
  } catch (_) {}

  let realJwplayer;
  try {
    Object.defineProperty(window, 'jwplayer', {
      configurable: true,
      enumerable: true,
      get() {
        return realJwplayer;
      },
      set(fn) {
        if (typeof fn !== 'function') {
          realJwplayer = fn;
          return;
        }
        const wrapped = function jwplayerWrapped(...args) {
          const instance = fn.apply(this, args);
          if (instance && typeof instance.setup === 'function' && !instance.__abfWrapped) {
            const origSetup = instance.setup;
            instance.setup = function patchedSetup(cfg) {
              if (state.enabled && state.blockVast && cfg && typeof cfg === 'object' && cfg.advertising) {
                delete cfg.advertising;
                reportBlocked('vast', 1);
              }
              return origSetup.apply(this, arguments);
            };
            instance.__abfWrapped = true;
          }
          return instance;
        };
        Object.assign(wrapped, fn);
        realJwplayer = wrapped;
      },
    });
  } catch (_) {}

  // 5. Popunder / clickunder shield protection around video players
  function isClickNearPlayerOrOverlay(target) {
    if (!(target instanceof Element)) return false;
    const tag = target.tagName;
    if (tag === 'VIDEO' || tag === 'IFRAME') return true;
    if (target.closest('[class*="player"], [id*="player"], [class*="video"], [id*="video"]')) {
      return true;
    }
    try {
      const style = window.getComputedStyle(target);
      const opacity = parseFloat(style.opacity);
      const z = parseInt(style.zIndex, 10);
      const rect = target.getBoundingClientRect();
      const largeTransparent =
        (opacity < 0.15 || style.backgroundColor === 'rgba(0, 0, 0, 0)') &&
        rect.width > 160 &&
        rect.height > 120 &&
        (Number.isFinite(z) && z >= 10);
      if (largeTransparent && document.querySelector('video, iframe')) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (isClickNearPlayerOrOverlay(e.target)) {
        state.lastPlayerClickAt = Date.now();
      }
    },
    true
  );

  const origWindowOpen = window.open;
  window.open = function patchedWindowOpen(url) {
    if (state.enabled && state.blockPopunder) {
      const recentlyClickedPlayer = Date.now() - state.lastPlayerClickAt < 1400;
      const adUrl = isKnownAdUrl(String(url || ''));
      const blankPopunder = (!url || url === 'about:blank') && recentlyClickedPlayer;
      if (adUrl || blankPopunder || (recentlyClickedPlayer && document.querySelector('video, iframe'))) {
        reportBlocked('popunder', 1);
        return {
          closed: false,
          opener: null,
          focus() {},
          blur() {},
          close() {},
          postMessage() {},
          location: { href: String(url || '') },
          document: { open() {}, write() {}, writeln() {}, close() {} },
        };
      }
    }
    return origWindowOpen.apply(this, arguments);
  };

  // Block synthetic hidden <a target="_blank"> clickunder traps triggered on player clicks
  const origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function patchedAnchorClick() {
    if (state.enabled && state.blockPopunder) {
      const recentlyClickedPlayer = Date.now() - state.lastPlayerClickAt < 1400;
      const href = String(this.href || '');
      const opensNewTab = (this.target || '').toLowerCase() === '_blank';
      const externalAd = isKnownAdUrl(href);
      const detachedTrap = !this.isConnected && opensNewTab;
      if (externalAd || (recentlyClickedPlayer && (opensNewTab || detachedTrap) && document.querySelector('video, iframe'))) {
        reportBlocked('popunder', 1);
        return;
      }
    }
    return origAnchorClick.apply(this, arguments);
  };
})();
