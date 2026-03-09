const STATE_KEY = 'runnerState';
const CUSTOM_PRESET = '__custom__';
let refreshTimer = null;
let formHydrated = false;
let settingsHydrated = false;

const TIMEFRAME_PRESETS = [
  { value: 'today 12-m', label: '过去 12 个月' },
  { value: 'now 1-H', label: '过去 1 小时' },
  { value: 'now 4-H', label: '过去 4 小时' },
  { value: 'now 7-d', label: '最近 7 天' },
  { value: 'now 1-d', label: '最近 1 天' },
  { value: 'today 1-m', label: '过去 30 天' },
  { value: 'today 3-m', label: '过去 90 天' },
  { value: 'today 5-y', label: '过去 5 年' },
  { value: 'all', label: '2004 至今' },
  { value: CUSTOM_PRESET, label: '自定义时间范围' },
];

const GEO_PRESETS = [
  { value: '', label: '全球' },
  { value: 'CN', label: '中国' },
  { value: 'US', label: '美国' },
  { value: 'JP', label: '日本' },
  { value: 'GB', label: '英国' },
  { value: 'DE', label: '德国' },
  { value: 'FR', label: '法国' },
  { value: 'IN', label: '印度' },
  { value: CUSTOM_PRESET, label: '手动输入' },
];

const FETCH_MODE_LABELS = {
  api: 'API 模式',
  page: '页面模式',
  hybrid: '混合模式',
};

const elements = {
  keywords: document.getElementById('keywords'),
  fetchMode: document.getElementById('fetchMode'),
  timeframePreset: document.getElementById('timeframePreset'),
  timeframeCustom: document.getElementById('timeframeCustom'),
  geoPreset: document.getElementById('geoPreset'),
  geoCustom: document.getElementById('geoCustom'),
  minDelay: document.getElementById('minDelay'),
  maxDelay: document.getElementById('maxDelay'),
  startBtn: document.getElementById('startBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  resumeBtn: document.getElementById('resumeBtn'),
  captchaBtn: document.getElementById('captchaBtn'),
  exportBtn: document.getElementById('exportBtn'),
  endRunBtn: document.getElementById('endRunBtn'),
  clearBtn: document.getElementById('clearBtn'),
  autoDownloadCsv: document.getElementById('autoDownloadCsv'),
  aiLocatorEnabled: document.getElementById('aiLocatorEnabled'),
  openAIApiKey: document.getElementById('openAIApiKey'),
  openAIBaseUrl: document.getElementById('openAIBaseUrl'),
  openAIModel: document.getElementById('openAIModel'),
  statusText: document.getElementById('statusText'),
  stageText: document.getElementById('stageText'),
  progressText: document.getElementById('progressText'),
  currentKeywordText: document.getElementById('currentKeywordText'),
  resultCountText: document.getElementById('resultCountText'),
  errorCountText: document.getElementById('errorCountText'),
  lastErrorText: document.getElementById('lastErrorText'),
  messageText: document.getElementById('messageText'),
  paramFetchModeText: document.getElementById('paramFetchModeText'),
  paramActiveModeText: document.getElementById('paramActiveModeText'),
  paramTimeframeText: document.getElementById('paramTimeframeText'),
  paramGeoText: document.getElementById('paramGeoText'),
  paramCategoryText: document.getElementById('paramCategoryText'),
  paramPropertyText: document.getElementById('paramPropertyText'),
  paramLanguageText: document.getElementById('paramLanguageText'),
  paramTimezoneText: document.getElementById('paramTimezoneText'),
  resultList: document.getElementById('resultList'),
  errorList: document.getElementById('errorList'),
};

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function formatStatus(state) {
  const labels = {
    idle: '空闲',
    running: '运行中',
    paused: '已暂停',
    captcha: '等待人工验证',
    completed: '已完成',
    terminated: '已结束',
    error: '错误',
  };
  return labels[state.status] || state.status;
}

function getTimezoneParam() {
  return String(-new Date().getTimezoneOffset());
}

function getResolvedActiveMode(fetchMode, fallbackActivated = false) {
  if (fetchMode === 'page') {
    return 'page';
  }
  if (fetchMode === 'hybrid' && fallbackActivated) {
    return 'page';
  }
  return 'api';
}

function formatConfiguredMode(fetchMode, fallbackActivated = false) {
  const label = FETCH_MODE_LABELS[fetchMode] || FETCH_MODE_LABELS.api;
  if (fetchMode === 'hybrid' && fallbackActivated) {
    return `${label}（已切到页面模式）`;
  }
  return label;
}

function formatActiveMode(fetchMode, fallbackActivated = false) {
  const activeMode = getResolvedActiveMode(fetchMode, fallbackActivated);
  if (fetchMode === 'hybrid') {
    return activeMode === 'page' ? '页面模式（由混合模式切换）' : 'API 模式';
  }
  return FETCH_MODE_LABELS[activeMode] || FETCH_MODE_LABELS.api;
}

function fillPresetOptions(selectElement, presets) {
  selectElement.innerHTML = '';
  presets.forEach((preset) => {
    const option = document.createElement('option');
    option.value = preset.value;
    option.textContent = preset.label;
    selectElement.appendChild(option);
  });
}

function findPresetValue(value, presets) {
  const normalized = value ?? '';
  const matched = presets.find((item) => item.value === normalized);
  return matched ? matched.value : CUSTOM_PRESET;
}

function syncPresetInput(selectElement, inputElement, presets, currentValue) {
  const presetValue = findPresetValue(currentValue, presets);
  selectElement.value = presetValue;
  inputElement.value = currentValue ?? '';
  inputElement.disabled = presetValue !== CUSTOM_PRESET;
}

function getResolvedFieldValue(selectElement, inputElement) {
  return selectElement.value === CUSTOM_PRESET
    ? inputElement.value.trim()
    : selectElement.value;
}

function formatTimeframeLabel(value) {
  const preset = TIMEFRAME_PRESETS.find((item) => item.value === value);
  if (preset && preset.value !== CUSTOM_PRESET) {
    return `${preset.label}（${value}）`;
  }
  return value ? `手动输入（${value}）` : '-';
}

function formatGeoLabel(value) {
  const preset = GEO_PRESETS.find((item) => item.value === value);
  if (preset && preset.value !== CUSTOM_PRESET) {
    return `${preset.label}${value ? `（${value}）` : '（留空）'}`;
  }
  return value ? `手动输入（${value}）` : '全球（留空）';
}

function renderParams(timeframe, geo, fetchMode, fallbackActivated) {
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '本地时区';
  elements.paramFetchModeText.textContent = formatConfiguredMode(fetchMode, fallbackActivated);
  elements.paramActiveModeText.textContent = formatActiveMode(fetchMode, fallbackActivated);
  elements.paramTimeframeText.textContent = formatTimeframeLabel(timeframe);
  elements.paramGeoText.textContent = formatGeoLabel(geo);
  elements.paramCategoryText.textContent = '全部（category=0）';
  elements.paramPropertyText.textContent = '网页搜索（property=空）';
  elements.paramLanguageText.textContent = 'en';
  elements.paramTimezoneText.textContent = `${browserTimezone}（tz=${getTimezoneParam()}）`;
}

function renderResults(results) {
  elements.resultList.innerHTML = '';
  const recent = [...results].slice(-8).reverse();
  if (!recent.length) {
    const empty = document.createElement('li');
    empty.textContent = '暂无结果';
    elements.resultList.appendChild(empty);
    return;
  }

  recent.forEach((item) => {
    const li = document.createElement('li');
    const modeText = item.fetchMode === 'page' ? '页面' : 'API';
    li.textContent = `${item.keyword} · ${item.type} · ${item.relatedQuery}（${item.value}） · ${modeText}`;
    elements.resultList.appendChild(li);
  });
}

function renderErrors(errors) {
  elements.errorList.innerHTML = '';
  const recent = [...errors].slice(-5).reverse();
  if (!recent.length) {
    const empty = document.createElement('li');
    empty.textContent = '暂无错误';
    elements.errorList.appendChild(empty);
    return;
  }

  recent.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = `${item.keyword} · ${item.message}`;
    elements.errorList.appendChild(li);
  });
}

function renderState(state) {
  const latestError = state.errors.length ? state.errors[state.errors.length - 1] : null;
  const timeframe = state.timeframe || 'today 12-m';
  const geo = state.geo || '';
  const fetchMode = state.fetchMode || 'api';
  const fallbackActivated = Boolean(state.fallbackActivated);

  elements.statusText.textContent = formatStatus(state);
  elements.stageText.textContent = state.currentStage || '-';
  elements.progressText.textContent = `${state.currentIndex} / ${state.queue.length}`;
  elements.currentKeywordText.textContent = state.currentKeyword || state.queue[state.currentIndex] || '-';
  elements.resultCountText.textContent = String(state.results.length);
  elements.errorCountText.textContent = String(state.errors.length);
  elements.lastErrorText.textContent = latestError?.message || state.lastError || '-';

  const remainSeconds = state.nextRunAt
    ? Math.max(0, Math.ceil((state.nextRunAt - Date.now()) / 1000))
    : 0;

  if (state.status === 'captcha' && state.captcha) {
    elements.messageText.textContent = state.message || `${state.captcha.message} 当前关键词：${state.captcha.keyword}`;
  } else if (state.currentStage === '等待下一个关键词' && state.nextRunAt) {
    elements.messageText.textContent = `等待下一个关键词（约 ${remainSeconds} 秒）`;
  } else if (state.message) {
    elements.messageText.textContent = state.message;
  } else if (state.lastError) {
    elements.messageText.textContent = state.lastError;
  } else {
    elements.messageText.textContent = '等待开始。';
  }

  const shouldSyncForm = !formHydrated || state.status === 'running' || state.status === 'captcha';
  if (shouldSyncForm) {
    elements.keywords.value = state.queue.join('\n');
    elements.fetchMode.value = fetchMode;
    syncPresetInput(elements.timeframePreset, elements.timeframeCustom, TIMEFRAME_PRESETS, timeframe);
    syncPresetInput(elements.geoPreset, elements.geoCustom, GEO_PRESETS, geo);
    elements.minDelay.value = state.minDelaySeconds || 12;
    elements.maxDelay.value = state.maxDelaySeconds || 20;
    elements.autoDownloadCsv.checked = Boolean(state.autoDownloadCsv);
    formHydrated = true;
  }

  if (state.status === 'running' || state.status === 'captcha') {
    renderParams(timeframe, geo, fetchMode, fallbackActivated);
  } else {
    renderCurrentParams();
  }
  renderResults(state.results);
  renderErrors(state.errors);

  elements.startBtn.disabled = state.status === 'running';
  elements.pauseBtn.disabled = state.status !== 'running';
  elements.resumeBtn.disabled = state.status !== 'paused';
  elements.captchaBtn.disabled = state.status !== 'captcha';
  elements.exportBtn.disabled = !state.results.length;
  elements.endRunBtn.disabled = !['running', 'paused', 'captcha'].includes(state.status);
}

function renderSettings(settings = {}) {
  if (settingsHydrated) {
    return;
  }
  elements.aiLocatorEnabled.checked = Boolean(settings.aiLocatorEnabled);
  elements.openAIApiKey.value = settings.openAIApiKey || '';
  elements.openAIBaseUrl.value = settings.openAIBaseUrl || 'https://api.openai.com/v1';
  elements.openAIModel.value = settings.openAIModel || 'gpt-4o-mini';
  settingsHydrated = true;
}

function renderCurrentParams() {
  renderParams(
    getResolvedFieldValue(elements.timeframePreset, elements.timeframeCustom) || 'today 12-m',
    getResolvedFieldValue(elements.geoPreset, elements.geoCustom),
    elements.fetchMode.value || 'api',
    false
  );
}

async function refresh() {
  try {
    const response = await sendMessage({ type: 'getState' });
    renderState(response.state);
    renderSettings(response.settings);
  } catch (error) {
    elements.messageText.textContent = error instanceof Error ? error.message : String(error);
  }
}

function ensureAutoRefresh() {
  if (refreshTimer !== null) {
    return;
  }
  refreshTimer = window.setInterval(refresh, 1000);
}

function stopAutoRefresh() {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function handlePresetChange(selectElement, inputElement) {
  const isCustom = selectElement.value === CUSTOM_PRESET;
  inputElement.disabled = !isCustom;
  if (!isCustom) {
    inputElement.value = selectElement.value;
  } else {
    inputElement.focus();
  }
  renderCurrentParams();
}

async function startRun() {
  const keywords = elements.keywords.value
    .split(/\n+/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  const timeframe = getResolvedFieldValue(elements.timeframePreset, elements.timeframeCustom);
  const geo = getResolvedFieldValue(elements.geoPreset, elements.geoCustom);
  const fetchMode = elements.fetchMode.value || 'api';

  if (!keywords.length) {
    elements.messageText.textContent = '请先输入至少一个关键词。';
    return;
  }

  if (!timeframe) {
    elements.messageText.textContent = '请先选择或输入时间范围。';
    return;
  }

  const response = await sendMessage({
    type: 'startRun',
    payload: {
      keywords,
      fetchMode,
      timeframe,
      geo,
      minDelaySeconds: Number(elements.minDelay.value),
      maxDelaySeconds: Number(elements.maxDelay.value),
    },
  });
  renderState(response.state);

  if (fetchMode === 'api') {
    elements.messageText.textContent = '任务已启动。API 模式默认不打开新标签页。';
    return;
  }

  if (fetchMode === 'page') {
    elements.messageText.textContent = '任务已启动。页面模式会打开并复用 Trends 页面标签页。';
    return;
  }

  elements.messageText.textContent = '任务已启动。混合模式会先走 API，限流后自动切到页面模式。';
}

async function pauseRun() {
  const response = await sendMessage({ type: 'pauseRun' });
  renderState(response.state);
  elements.messageText.textContent = '任务已暂停。';
}

async function resumeRun() {
  const response = await sendMessage({ type: 'resumeRun' });
  renderState(response.state);
  elements.messageText.textContent = '任务恢复中。';
}

async function continueAfterCaptcha() {
  const response = await sendMessage({ type: 'continueAfterCaptcha' });
  renderState(response.state);
  elements.messageText.textContent = '已收到继续指令，准备重试当前关键词。';
}

async function exportResults() {
  try {
    await sendMessage({ type: 'exportResults' });
    elements.messageText.textContent = '已触发 CSV 下载。';
  } catch (error) {
    elements.messageText.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function clearResults() {
  const response = await sendMessage({ type: 'clearResults' });
  renderState(response.state);
  elements.keywords.value = '';
  renderCurrentParams();
}

async function terminateRun() {
  const response = await sendMessage({ type: 'terminateRun' });
  renderState(response.state);
}

async function updateDownloadSettings() {
  try {
    await sendMessage({
      type: 'updateDownloadSettings',
      payload: {
        autoDownloadCsv: elements.autoDownloadCsv.checked,
      },
    });
  } catch (error) {
    elements.messageText.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function updateAiSettings() {
  try {
    await sendMessage({
      type: 'updateAiSettings',
      payload: {
        aiLocatorEnabled: elements.aiLocatorEnabled.checked,
        openAIApiKey: elements.openAIApiKey.value,
        openAIBaseUrl: elements.openAIBaseUrl.value,
        openAIModel: elements.openAIModel.value,
      },
    });
  } catch (error) {
    elements.messageText.textContent = error instanceof Error ? error.message : String(error);
  }
}

elements.startBtn.addEventListener('click', startRun);
elements.pauseBtn.addEventListener('click', pauseRun);
elements.resumeBtn.addEventListener('click', resumeRun);
elements.captchaBtn.addEventListener('click', continueAfterCaptcha);
elements.exportBtn.addEventListener('click', exportResults);
elements.endRunBtn.addEventListener('click', terminateRun);
elements.clearBtn.addEventListener('click', clearResults);
elements.fetchMode.addEventListener('change', renderCurrentParams);
elements.timeframePreset.addEventListener('change', () => {
  handlePresetChange(elements.timeframePreset, elements.timeframeCustom);
});
elements.geoPreset.addEventListener('change', () => {
  handlePresetChange(elements.geoPreset, elements.geoCustom);
});
elements.timeframeCustom.addEventListener('input', renderCurrentParams);
elements.geoCustom.addEventListener('input', renderCurrentParams);
elements.autoDownloadCsv.addEventListener('change', updateDownloadSettings);
elements.aiLocatorEnabled.addEventListener('change', updateAiSettings);
elements.openAIApiKey.addEventListener('change', updateAiSettings);
elements.openAIApiKey.addEventListener('blur', updateAiSettings);
elements.openAIBaseUrl.addEventListener('change', updateAiSettings);
elements.openAIBaseUrl.addEventListener('blur', updateAiSettings);
elements.openAIModel.addEventListener('change', updateAiSettings);
elements.openAIModel.addEventListener('blur', updateAiSettings);

document.addEventListener('DOMContentLoaded', () => {
  fillPresetOptions(elements.timeframePreset, TIMEFRAME_PRESETS);
  fillPresetOptions(elements.geoPreset, GEO_PRESETS);
  renderCurrentParams();
  refresh();
  ensureAutoRefresh();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }
  if (changes[STATE_KEY]) {
    renderState(changes[STATE_KEY].newValue);
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopAutoRefresh();
  } else {
    refresh();
    ensureAutoRefresh();
  }
});

window.addEventListener('beforeunload', stopAutoRefresh);
