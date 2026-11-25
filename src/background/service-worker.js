'use strict';

const DEFAULT_SETTINGS = {
  enabled: true,
  skipVideoAds: true,
  muteDuringAds: true,
  playbackSpeed: 16,
  blockVast: true,
  blockPopunder: true,
  removeOverlays: true,
  showToast: true,
  disabledHosts: [],
};

const DEFAULT_STATS = {
  totalBlocked: 0,
  videoSkipped: 0,
  vastBlocked: 0,
  popundersBlocked: 0,
  overlaysRemoved: 0,
  timeSavedSec: 0,
};

const TIME_SAVED_WEIGHT = {
  video: 15,
  vast: 12,
  popunder: 4,
  overlay: 2,
};

const DYNAMIC_RULE_BASE_ID = 10001;
const tabStats = new Map();

function normalizeHost(hostOrUrl) {
  if (!hostOrUrl) return '';
  const str = String(hostOrUrl).trim();
  if (str.includes('://')) {
    try {
      const u = new URL(str);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.hostname.toLowerCase().replace(/^www\./, '');
    } catch (_) {
      return '';
    }
  }
  return str
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9.-]/g, '');
}

function isHostDisabled(host, disabledHosts) {
  const clean = normalizeHost(host);
  if (!clean || !Array.isArray(disabledHosts)) return false;
  return disabledHosts.some((d) => {
    const target = normalizeHost(d);
    return target && (clean === target || clean.endsWith('.' + target));
  });
}

async function getSettings() {
  const data = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
}

async function getStats() {
  const data = await chrome.storage.local.get('stats');
  return { ...DEFAULT_STATS, ...(data.stats || {}) };
}

async function syncDnrRules(settings) {
  try {
    if (settings.enabled) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: ['video_ad_rules'],
      });
    } else {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: ['video_ad_rules'],
      });
    }

    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing.map((r) => r.id);

    const hosts = settings.enabled
      ? (settings.disabledHosts || []).map(normalizeHost).filter(Boolean)
      : [];
    const addRules = [];
    if (hosts.length > 0) {
      addRules.push({
        id: DYNAMIC_RULE_BASE_ID,
        priority: 1000,
        action: { type: 'allowAllRequests' },
        condition: {
          requestDomains: hosts,
          resourceTypes: ['main_frame', 'sub_frame'],
        },
      });
      addRules.push({
        id: DYNAMIC_RULE_BASE_ID + 1,
        priority: 1000,
        action: { type: 'allow' },
        condition: {
          initiatorDomains: hosts,
        },
      });
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules,
    });
  } catch (err) {
    console.warn('[AdBlockFilms] DNR sync error:', err);
  }
}

async function updateTabBadge(tabId, url) {
  if (!tabId || tabId < 0) return;
  const settings = await getSettings();
  const host = normalizeHost(url);
  const paused = !settings.enabled || isHostDisabled(host, settings.disabledHosts);

  try {
    if (paused) {
      await chrome.action.setBadgeText({ tabId, text: 'OFF' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#64748b' });
      return;
    }

    const entry = tabStats.get(tabId);
    const count = entry ? entry.total : 0;
    await chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count > 999 ? '999+' : count) : '' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#10b981' });
  } catch (_) {}
}

async function broadcastSettings(settings) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id) continue;
      const tabHost = normalizeHost(tab.url);
      chrome.tabs
        .sendMessage(tab.id, {
          type: 'CONFIG_UPDATED',
          settings,
          tabHost,
        })
        .catch(() => {});
      updateTabBadge(tab.id, tab.url);
    }
  } catch (_) {}
}

async function saveSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  if (Array.isArray(next.disabledHosts)) {
    next.disabledHosts = [...new Set(next.disabledHosts.map(normalizeHost).filter(Boolean))];
  }
  await chrome.storage.local.set({ settings: next });
  await syncDnrRules(next);
  await broadcastSettings(next);
  return next;
}

async function recordBlockedBatch(tabId, tabUrl, batch) {
  if (!batch || typeof batch !== 'object') return;
  const stats = await getStats();

  let tabEntry = tabId ? tabStats.get(tabId) : null;
  if (tabId && !tabEntry) {
    tabEntry = { total: 0, video: 0, vast: 0, popunder: 0, overlay: 0 };
    tabStats.set(tabId, tabEntry);
  }

  for (const [kind, rawCount] of Object.entries(batch)) {
    const count = Math.max(0, Number(rawCount) || 0);
    if (!count) continue;

    stats.totalBlocked += count;
    stats.timeSavedSec += count * (TIME_SAVED_WEIGHT[kind] || 5);

    if (kind === 'video') stats.videoSkipped += count;
    else if (kind === 'vast') stats.vastBlocked += count;
    else if (kind === 'popunder') stats.popundersBlocked += count;
    else if (kind === 'overlay') stats.overlaysRemoved += count;

    if (tabEntry) {
      tabEntry.total += count;
      if (kind in tabEntry) tabEntry[kind] += count;
    }
  }

  await chrome.storage.local.set({ stats });
  if (tabId) {
    await updateTabBadge(tabId, tabUrl);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(['settings', 'stats']);
  const settings = { ...DEFAULT_SETTINGS, ...(existing.settings || {}) };
  const stats = { ...DEFAULT_STATS, ...(existing.stats || {}) };
  await chrome.storage.local.set({ settings, stats });
  await syncDnrRules(settings);
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  await syncDnrRules(settings);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStats.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    tabStats.set(tabId, { total: 0, video: 0, vast: 0, popunder: 0, overlay: 0 });
    updateTabBadge(tabId, changeInfo.url);
  } else if (changeInfo.status === 'complete' && tab?.url) {
    updateTabBadge(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    updateTabBadge(tabId, tab.url);
  } catch (_) {}
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;

  if (msg.type === 'GET_TAB_CONFIG') {
    (async () => {
      const settings = await getSettings();
      const tabHost = normalizeHost(sender?.tab?.url || '');
      sendResponse({ settings, tabHost });
    })();
    return true;
  }

  if (msg.type === 'AD_BLOCKED_BATCH') {
    (async () => {
      await recordBlockedBatch(sender?.tab?.id, sender?.tab?.url, msg.batch);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === 'GET_POPUP_STATE') {
    (async () => {
      const [settings, stats] = await Promise.all([getSettings(), getStats()]);
      let activeTab = null;
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        activeTab = tabs[0] || null;
      } catch (_) {}
      const host = normalizeHost(activeTab?.url || '');
      const currentTabStats = activeTab?.id
        ? tabStats.get(activeTab.id) || { total: 0, video: 0, vast: 0, popunder: 0, overlay: 0 }
        : { total: 0, video: 0, vast: 0, popunder: 0, overlay: 0 };

      sendResponse({
        settings,
        stats,
        host,
        tabUrl: activeTab?.url || '',
        isSiteDisabled: isHostDisabled(host, settings.disabledHosts),
        currentTabStats,
      });
    })();
    return true;
  }

  if (msg.type === 'UPDATE_SETTINGS') {
    (async () => {
      const settings = await saveSettings(msg.settings || {});
      sendResponse({ ok: true, settings });
    })();
    return true;
  }

  if (msg.type === 'TOGGLE_SITE') {
    (async () => {
      const settings = await getSettings();
      const host = normalizeHost(msg.host);
      if (!host) {
        sendResponse({ ok: false, settings });
        return;
      }
      const list = new Set((settings.disabledHosts || []).map(normalizeHost).filter(Boolean));
      if (list.has(host)) list.delete(host);
      else list.add(host);
      const next = await saveSettings({ disabledHosts: [...list] });
      sendResponse({ ok: true, settings: next, isSiteDisabled: isHostDisabled(host, next.disabledHosts) });
    })();
    return true;
  }

  if (msg.type === 'RESET_STATS') {
    (async () => {
      await chrome.storage.local.set({ stats: { ...DEFAULT_STATS } });
      tabStats.clear();
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) updateTabBadge(tab.id, tab.url);
      }
      sendResponse({ ok: true, stats: { ...DEFAULT_STATS } });
    })();
    return true;
  }

  return false;
});
