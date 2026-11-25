'use strict';

const CHECKBOX_KEYS = [
  'enabled',
  'skipVideoAds',
  'muteDuringAds',
  'blockVast',
  'blockPopunder',
  'removeOverlays',
  'showToast',
];

let currentSettings = null;
let saveTimer = null;

function showSavedBadge() {
  const badge = document.getElementById('save-indicator');
  badge.classList.add('visible');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => badge.classList.remove('visible'), 1400);
}

function formatTimeSaved(seconds) {
  const sec = Math.max(0, Number(seconds) || 0);
  if (sec < 60) return `${sec}с`;
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins} мин`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}ч ${remMins}м` : `${hours}ч`;
}

function renderWhitelist(hosts) {
  const list = document.getElementById('whitelist-list');
  list.innerHTML = '';
  if (!hosts || hosts.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'whitelist-empty';
    empty.textContent = 'Список исключений пуст — защита работает на всех сайтах.';
    list.appendChild(empty);
    return;
  }

  for (const host of hosts) {
    const li = document.createElement('li');
    li.className = 'whitelist-item';

    const name = document.createElement('span');
    name.textContent = host;

    const btn = document.createElement('button');
    btn.className = 'remove-btn';
    btn.textContent = 'Удалить';
    btn.addEventListener('click', async () => {
      const next = (currentSettings.disabledHosts || []).filter((h) => h !== host);
      await savePartial({ disabledHosts: next });
    });

    li.append(name, btn);
    list.appendChild(li);
  }
}

function renderStats(stats) {
  document.getElementById('total-blocked').textContent = String(stats?.totalBlocked || 0);
  document.getElementById('video-skipped').textContent = String(stats?.videoSkipped || 0);
  document.getElementById('vast-blocked').textContent = String(stats?.vastBlocked || 0);
  document.getElementById('popunders-blocked').textContent = String(stats?.popundersBlocked || 0);
  document.getElementById('overlays-removed').textContent = String(stats?.overlaysRemoved || 0);
  document.getElementById('time-saved').textContent = formatTimeSaved(stats?.timeSavedSec || 0);
}

function renderAll(settings, stats) {
  currentSettings = settings;
  for (const key of CHECKBOX_KEYS) {
    const el = document.getElementById(`opt-${key}`);
    if (el) el.checked = !!settings[key];
  }
  const speedEl = document.getElementById('opt-playbackSpeed');
  if (speedEl) speedEl.value = String(settings.playbackSpeed || 16);

  renderWhitelist(settings.disabledHosts || []);
  renderStats(stats);
}

async function savePartial(partial) {
  const resp = await chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS',
    settings: partial,
  });
  if (resp?.settings) {
    currentSettings = resp.settings;
    renderWhitelist(currentSettings.disabledHosts || []);
    showSavedBadge();
  }
}

async function loadOptions() {
  const data = await chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' });
  if (data) {
    renderAll(data.settings, data.stats);
  }
}

for (const key of CHECKBOX_KEYS) {
  const el = document.getElementById(`opt-${key}`);
  el?.addEventListener('change', () => {
    savePartial({ [key]: el.checked });
  });
}

document.getElementById('opt-playbackSpeed')?.addEventListener('change', (e) => {
  savePartial({ playbackSpeed: Number(e.target.value) || 16 });
});

document.getElementById('whitelist-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('whitelist-input');
  const raw = (input.value || '').trim();
  if (!raw || !currentSettings) return;
  const host = raw
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .toLowerCase()
    .replace(/^www\./, '');
  if (!host) return;
  const set = new Set(currentSettings.disabledHosts || []);
  set.add(host);
  input.value = '';
  await savePartial({ disabledHosts: [...set] });
});

document.getElementById('reset-stats-btn')?.addEventListener('click', async () => {
  const resp = await chrome.runtime.sendMessage({ type: 'RESET_STATS' });
  if (resp?.stats) renderStats(resp.stats);
});

loadOptions();
