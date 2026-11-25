'use strict';

const SETTING_IDS = ['skipVideoAds', 'muteDuringAds', 'blockVast', 'blockPopunder'];

let currentHost = '';
let currentSettings = null;

function formatTimeSaved(seconds) {
  const sec = Math.max(0, Number(seconds) || 0);
  if (sec < 60) return `${sec}с`;
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins}м`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}ч ${remMins}м` : `${hours}ч`;
}

function renderState(data) {
  const { settings, stats, host, isSiteDisabled, currentTabStats } = data;
  currentSettings = settings;
  currentHost = host || '';

  const powerBtn = document.getElementById('power-btn');
  const statusPill = document.getElementById('status-pill');
  const siteHostEl = document.getElementById('site-host');
  const siteToggleBtn = document.getElementById('site-toggle-btn');

  powerBtn.classList.toggle('active', !!settings.enabled);

  statusPill.className = 'status-pill';
  if (!settings.enabled) {
    statusPill.classList.add('status-paused');
    statusPill.textContent = 'На паузе';
  } else if (isSiteDisabled) {
    statusPill.classList.add('status-site-off');
    statusPill.textContent = 'Откл. на сайте';
  } else {
    statusPill.classList.add('status-active');
    statusPill.textContent = 'Защита активна';
  }

  if (currentHost) {
    siteHostEl.textContent = currentHost;
    siteToggleBtn.disabled = false;
    siteToggleBtn.classList.toggle('is-disabled', !!isSiteDisabled);
    siteToggleBtn.textContent = isSiteDisabled ? 'Включить на сайте' : 'Отключить на сайте';
  } else {
    siteHostEl.textContent = 'Системная страница';
    siteToggleBtn.disabled = true;
    siteToggleBtn.classList.remove('is-disabled');
    siteToggleBtn.textContent = 'Недоступно';
  }

  document.getElementById('stat-tab').textContent = String(currentTabStats?.total || 0);
  document.getElementById('stat-total').textContent = String(stats?.totalBlocked || 0);
  document.getElementById('stat-time').textContent = formatTimeSaved(stats?.timeSavedSec || 0);

  document.getElementById('stat-video').textContent = String(stats?.videoSkipped || 0);
  document.getElementById('stat-vast').textContent = String(stats?.vastBlocked || 0);
  document.getElementById('stat-popunder').textContent = String(stats?.popundersBlocked || 0);
  document.getElementById('stat-overlay').textContent = String(stats?.overlaysRemoved || 0);

  for (const key of SETTING_IDS) {
    const el = document.getElementById(`opt-${key}`);
    if (el) el.checked = !!settings[key];
  }
}

async function loadState() {
  const data = await chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' });
  if (data) renderState(data);
}

document.getElementById('power-btn').addEventListener('click', async () => {
  if (!currentSettings) return;
  await chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS',
    settings: { enabled: !currentSettings.enabled },
  });
  await loadState();
});

document.getElementById('site-toggle-btn').addEventListener('click', async () => {
  if (!currentHost) return;
  await chrome.runtime.sendMessage({
    type: 'TOGGLE_SITE',
    host: currentHost,
  });
  await loadState();
});

for (const key of SETTING_IDS) {
  const el = document.getElementById(`opt-${key}`);
  el?.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: { [key]: el.checked },
    });
    await loadState();
  });
}

document.getElementById('open-options-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('reset-stats-btn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'RESET_STATS' });
  await loadState();
});

loadState();
