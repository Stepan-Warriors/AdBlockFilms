(() => {
  'use strict';

  const g = (window.google = window.google || {});
  if (g.ima && g.ima.__abfStub) return;

  const notifyBlocked = () => {
    try {
      window.dispatchEvent(
        new CustomEvent('__ABF_BLOCKED__', { detail: { kind: 'vast', count: 1 } })
      );
    } catch (_) {}
  };

  class EventEmitter {
    constructor() {
      this._listeners = new Map();
    }
    addEventListener(type, fn) {
      if (typeof fn !== 'function') return;
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) {
      this._listeners.get(type)?.delete(fn);
    }
    _emit(type, eventObj) {
      const set = this._listeners.get(type);
      if (!set) return;
      for (const fn of [...set]) {
        try {
          fn.call(this, eventObj);
        } catch (_) {}
      }
    }
  }

  class AdError {
    constructor(message = 'No ads', errorCode = 1009, type = 'adLoadError') {
      this._message = message;
      this._errorCode = errorCode;
      this._type = type;
    }
    getMessage() { return this._message; }
    getErrorCode() { return this._errorCode; }
    getVastErrorCode() { return this._errorCode; }
    getType() { return this._type; }
    getInnerError() { return null; }
    toString() { return `${this._type}: ${this._message}`; }
  }

  class ImaSdkSettings {
    constructor() {
      this._locale = 'ru';
      this._autoPlayAdBreaks = true;
      this._vpaidMode = 2;
    }
    setLocale(v) { this._locale = v; }
    getLocale() { return this._locale; }
    setVpaidMode(v) { this._vpaidMode = v; }
    getVpaidMode() { return this._vpaidMode; }
    setAutoPlayAdBreaks(v) { this._autoPlayAdBreaks = !!v; }
    getAutoPlayAdBreaks() { return this._autoPlayAdBreaks; }
    setNumRedirects() {}
    setDisableCustomPlaybackForIOS10Plus() {}
    setPlayerType() {}
    setPlayerVersion() {}
    setCookiesEnabled() {}
    setSessionId() {}
    setFeatureFlags() {}
  }
  ImaSdkSettings.VpaidMode = { DISABLED: 0, ENABLED: 1, INSECURE: 2 };

  class AdDisplayContainer {
    constructor() {}
    initialize() {}
    destroy() {}
  }

  class AdsRequest {
    constructor() {
      this.adTagUrl = '';
      this.adsResponse = '';
    }
    setAdWillAutoPlay() {}
    setAdWillPlayMuted() {}
    setContinuousPlayback() {}
  }

  class AdsRenderingSettings {
    constructor() {
      this.restoreCustomPlaybackStateOnAdBreakComplete = true;
      this.enablePreloading = false;
    }
  }

  class AdsManager extends EventEmitter {
    constructor() {
      super();
      this._volume = 0;
    }
    init() {}
    start() {
      notifyBlocked();
      setTimeout(() => {
        this._emit('contentResumeRequested', { type: 'contentResumeRequested', getAd: () => null });
        this._emit('allAdsCompleted', { type: 'allAdsCompleted', getAd: () => null });
      }, 0);
    }
    pause() {}
    resume() {}
    stop() {}
    destroy() { this._listeners.clear(); }
    resize() {}
    collapse() {}
    focus() {}
    discardAdBreak() {}
    updateAdsRenderingSettings() {}
    setVolume(v) { this._volume = Number(v) || 0; }
    getVolume() { return this._volume; }
    getRemainingTime() { return 0; }
    getCuePoints() { return []; }
    getAdSkippableState() { return true; }
    isCustomClickTrackingUsed() { return false; }
    isCustomPlaybackUsed() { return false; }
    getCurrentAd() {
      return {
        getAdId: () => '',
        getDuration: () => 0,
        getTitle: () => '',
        isLinear: () => true,
        isSkippable: () => true,
        getSkipTimeOffset: () => 0,
        getContentType: () => '',
        getWrapperAdIds: () => [],
      };
    }
  }

  class AdsLoader extends EventEmitter {
    constructor(container) {
      super();
      this._container = container;
      this._settings = new ImaSdkSettings();
    }
    getSettings() { return this._settings; }
    contentComplete() {}
    destroy() { this._listeners.clear(); }
    requestAds() {
      notifyBlocked();
      const manager = new AdsManager();
      setTimeout(() => {
        this._emit('adsManagerLoaded', {
          type: 'adsManagerLoaded',
          getAdsManager: () => manager,
          getUserRequestContext: () => null,
        });
      }, 0);
    }
  }

  g.ima = {
    __abfStub: true,
    VERSION: '3.0.0',
    settings: new ImaSdkSettings(),
    ImaSdkSettings,
    AdDisplayContainer,
    AdsRequest,
    AdsRenderingSettings,
    AdsLoader,
    AdsManager,
    AdError,
    ViewMode: { NORMAL: 'normal', FULLSCREEN: 'fullscreen' },
    UiElements: { AD_ATTRIBUTION: 'adAttribution', COUNTDOWN: 'countdown' },
    AdsManagerLoadedEvent: {
      Type: { ADS_MANAGER_LOADED: 'adsManagerLoaded' },
    },
    AdErrorEvent: {
      Type: { AD_ERROR: 'adError' },
    },
    AdEvent: {
      Type: {
        AD_BREAK_READY: 'adBreakReady',
        AD_BUFFERING: 'adBuffering',
        AD_METADATA: 'adMetadata',
        AD_PROGRESS: 'adProgress',
        ALL_ADS_COMPLETED: 'allAdsCompleted',
        CLICK: 'click',
        COMPLETE: 'complete',
        CONTENT_PAUSE_REQUESTED: 'contentPauseRequested',
        CONTENT_RESUME_REQUESTED: 'contentResumeRequested',
        DURATION_CHANGE: 'durationChange',
        FIRST_QUARTILE: 'firstQuartile',
        IMPRESSION: 'impression',
        INTERACTION: 'interaction',
        LINEAR_CHANGED: 'linearChanged',
        LOADED: 'loaded',
        LOG: 'log',
        MIDPOINT: 'midpoint',
        PAUSED: 'paused',
        RESUMED: 'resumed',
        SKIPPABLE_STATE_CHANGED: 'skippableStateChanged',
        SKIPPED: 'skipped',
        STARTED: 'started',
        THIRD_QUARTILE: 'thirdQuartile',
        USER_CLOSE: 'userClose',
        VOLUME_CHANGED: 'volumeChanged',
        VOLUME_MUTED: 'volumeMuted',
      },
    },
  };
})();
