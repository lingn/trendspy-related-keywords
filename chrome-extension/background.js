const STATE_KEY = 'runnerState';
const SETTINGS_KEY = 'runnerSettings';
const NEXT_FETCH_ALARM = 'next-fetch-alarm';
const EMBED_QUERIES_URL = 'https://trends.google.com/trends/embed/explore/RELATED_QUERIES';
const API_RELATED_QUERIES_URL = 'https://trends.google.com/trends/api/widgetdata/relatedsearches';

const FETCH_MODE_LABELS = {
  api: 'API 模式',
  page: '页面模式',
  hybrid: '混合模式',
};

const DEFAULT_SETTINGS = {
  aiLocatorEnabled: false,
  openAIApiKey: '',
  openAIBaseUrl: 'https://api.openai.com/v1',
  openAIModel: 'gpt-4o-mini',
};

const DEFAULTS = {
  status: 'idle',
  queue: [],
  currentIndex: 0,
  results: [],
  errors: [],
  captchaTabId: null,
  pageTabId: null,
  timeframe: 'today 12-m',
  geo: '',
  minDelaySeconds: 10,
  maxDelaySeconds: 20,
  fetchMode: 'api',
  fallbackActivated: false,
  queryTypeLabel: '全部',
  captcha: null,
  lastError: '',
  message: '等待开始。',
  currentKeyword: '',
  currentStage: '准备开始',
  nextRunAt: null,
  autoDownloadCsv: false,
  runId: '',
  lastAutoDownloadedRunId: '',
  updatedAt: null,
};

let processing = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelayMs(minSeconds, maxSeconds) {
  const min = Math.max(1, Number(minSeconds) || 1);
  const max = Math.max(min, Number(maxSeconds) || min);
  return Math.round((min + Math.random() * (max - min)) * 1000);
}

function nowIso() {
  return new Date().toISOString();
}

function getTimeZoneMinutes() {
  return String(-new Date().getTimezoneOffset());
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeFetchMode(mode) {
  return ['api', 'page', 'hybrid'].includes(mode) ? mode : 'api';
}

function resolveActiveMode(state) {
  if (state.fetchMode === 'page') {
    return 'page';
  }
  if (state.fetchMode === 'hybrid' && state.fallbackActivated) {
    return 'page';
  }
  return 'api';
}

function getFetchModeLabel(mode) {
  return FETCH_MODE_LABELS[normalizeFetchMode(mode)] || FETCH_MODE_LABELS.api;
}

function looksLikeCaptcha(url, text = '') {
  const normalizedUrl = String(url || '').toLowerCase();
  const normalizedText = String(text || '').toLowerCase();
  return (
    normalizedUrl.includes('google.com/sorry') ||
    normalizedText.includes('unusual traffic') ||
    normalizedText.includes('recaptcha') ||
    normalizedText.includes('进行人机身份验证') ||
    normalizedText.includes('验证您是真人') ||
    normalizedText.includes('press and hold')
  );
}

function decodeEscapeText(text) {
  let result = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== '\\') {
      result += char;
      continue;
    }

    index += 1;
    if (index >= text.length) {
      result += '\\';
      break;
    }

    const marker = text[index];
    switch (marker) {
      case 'n':
        result += '\n';
        break;
      case 'r':
        result += '\r';
        break;
      case 't':
        result += '\t';
        break;
      case 'b':
        result += '\b';
        break;
      case 'f':
        result += '\f';
        break;
      case 'v':
        result += '\v';
        break;
      case '\\':
        result += '\\';
        break;
      case '\'':
        result += '\'';
        break;
      case '"':
        result += '"';
        break;
      case '/':
        result += '/';
        break;
      case '0':
        result += '\0';
        break;
      case 'x': {
        const hex = text.slice(index + 1, index + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          result += String.fromCharCode(parseInt(hex, 16));
          index += 2;
        } else {
          result += 'x';
        }
        break;
      }
      case 'u': {
        const hex = text.slice(index + 1, index + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          result += String.fromCharCode(parseInt(hex, 16));
          index += 4;
        } else {
          result += 'u';
        }
        break;
      }
      default:
        result += marker;
        break;
    }
  }

  return result;
}

function extractEmbeddedData(text) {
  const match = text.match(/JSON\.parse\('((?:\\.|[^'])+)'\)/);
  if (!match) {
    throw new Error('无法从 embed 页面提取请求 token');
  }
  return JSON.parse(decodeEscapeText(match[1]));
}

function parseGoogleJsonPayload(text) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const payload = lines.at(-1);
  if (!payload) {
    throw new Error('Google Trends 返回了空响应');
  }
  return JSON.parse(payload.replace(/^\)\]\}',?/, '').trim());
}

function buildExploreParams(keyword, timeframe, geo) {
  return new URLSearchParams({
    req: JSON.stringify({
      comparisonItem: [{ keyword, time: timeframe, geo }],
      category: 0,
      property: '',
    }),
    hl: 'en',
    tz: getTimeZoneMinutes(),
  });
}

function buildExploreUrl(keyword, timeframe, geo) {
  const params = new URLSearchParams({
    hl: 'zh-CN',
    q: keyword,
    date: timeframe,
  });
  params.set('geo', geo || '');
  return `https://trends.google.com/trends/explore?${params.toString()}`;
}

function normalizeRankedKeywords(rankedKeyword = [], type) {
  return rankedKeyword
    .map((item) => ({
      relatedQuery: item.query || item.topic?.title || '',
      value: item.value ?? '',
      type,
    }))
    .filter((item) => item.relatedQuery);
}

function parseRelatedQueriesData(data) {
  const rankedList = data?.default?.rankedList || [];
  const top = rankedList[0]?.rankedKeyword
    ? normalizeRankedKeywords(rankedList[0].rankedKeyword, '热门')
    : [];
  const rising = rankedList[1]?.rankedKeyword
    ? normalizeRankedKeywords(rankedList[1].rankedKeyword, '上升')
    : [];
  return top.concat(rising);
}

async function getState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return { ...DEFAULTS, ...(stored[STATE_KEY] || {}) };
}

async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
}

async function saveState(nextState) {
  const state = { ...nextState, updatedAt: nowIso() };
  await chrome.storage.local.set({ [STATE_KEY]: state });
  return state;
}

async function saveSettings(nextSettings) {
  const settings = { ...DEFAULT_SETTINGS, ...nextSettings };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

function normalizeOpenAIBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    return DEFAULT_SETTINGS.openAIBaseUrl;
  }
  return trimmed;
}

function buildResponsesUrl(baseUrl) {
  const normalized = normalizeOpenAIBaseUrl(baseUrl);
  if (normalized.endsWith('/responses')) {
    return normalized;
  }
  return `${normalized}/responses`;
}

function buildOriginPattern(urlString) {
  const url = new URL(urlString);
  return `${url.protocol}//${url.host}/*`;
}

async function ensureHostPermissionForUrl(urlString) {
  const url = new URL(urlString);
  const originPattern = buildOriginPattern(urlString);
  const alreadyGranted = await chrome.permissions.contains({
    origins: [originPattern],
  });

  if (!alreadyGranted) {
    throw new Error(`未授予 ${url.origin} 的网络访问权限，请在面板中点击“测试连接”时授权该域名。`);
  }

  return originPattern;
}

async function patchState(partial) {
  const current = await getState();
  return saveState({ ...current, ...partial });
}

async function patchSettings(partial) {
  const current = await getSettings();
  return saveSettings({ ...current, ...partial });
}

async function resetRunState() {
  const current = await getState();
  return saveState({
    ...DEFAULTS,
    captchaTabId: current.captchaTabId,
    pageTabId: current.pageTabId,
    autoDownloadCsv: current.autoDownloadCsv,
    lastAutoDownloadedRunId: current.lastAutoDownloadedRunId,
  });
}

function buildCsv(results) {
  const header = ['关键词', '相关查询词', '数值', '类型', '抓取时间'];
  const rows = results.map((item) => [
    item.keyword,
    item.relatedQuery,
    item.value,
    item.type,
    item.capturedAt,
  ]);
  const escapeCell = (value) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [header, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n');
}

async function locateWidgetWithOpenAI(payload) {
  const settings = await getSettings();
  if (!settings.aiLocatorEnabled) {
    return {
      ok: false,
      message: 'AI 辅助定位未开启',
    };
  }

  const apiKey = String(settings.openAIApiKey || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      message: 'AI 辅助定位已开启，但未填写 OpenAI API Key',
    };
  }

  const baseUrl = normalizeOpenAIBaseUrl(settings.openAIBaseUrl);
  const model = String(settings.openAIModel || DEFAULT_SETTINGS.openAIModel).trim() || DEFAULT_SETTINGS.openAIModel;
  const responsesUrl = buildResponsesUrl(baseUrl);
  await ensureHostPermissionForUrl(responsesUrl);
  const prompt = [
    '你是 Google Trends 页面结构定位助手。',
    '任务：从候选卡片里选出“相关查询 / Related queries”那一张卡片。',
    '要求：只返回 JSON，不要解释。',
    'JSON 结构：{"widgetIndex": number, "confidence": number, "reason": string}',
    '规则：',
    '1. 优先选择标题明确是“相关查询”或“Related queries”的卡片。',
    '2. 不要选择“按区域显示的搜索热度”“相关主题”“热度随时间变化的趋势”等卡片。',
    '3. 如果候选里没有可靠目标，返回 {"widgetIndex": -1, "confidence": 0, "reason": "..."}。',
    '',
    `页面上下文：${JSON.stringify(payload.pageContext || {})}`,
    `候选卡片：${JSON.stringify(payload.candidates || [])}`,
  ].join('\n');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  let response;
  let data;

  try {
    response = await fetch(responsesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: prompt,
        text: {
          format: {
            type: 'json_object',
          },
        },
      }),
      signal: controller.signal,
    });
    data = await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('AI 定位请求超时（20 秒），已停止等待');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const apiMessage = data?.error?.message || `OpenAI 请求失败：HTTP ${response.status}`;
    throw new Error(apiMessage);
  }

  const rawText =
    data.output_text ||
    data.output?.[0]?.content?.find((item) => item.type === 'output_text')?.text ||
    '';

  if (!rawText) {
    throw new Error('OpenAI 没有返回可解析的定位结果');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`OpenAI 返回的 JSON 无法解析：${formatError(error)}`);
  }

  return {
    ok: true,
    widgetIndex: Number.isInteger(parsed.widgetIndex) ? parsed.widgetIndex : -1,
    confidence: Number(parsed.confidence) || 0,
    reason: String(parsed.reason || ''),
    model,
  };
}

async function chooseViewOptionWithOpenAI(payload) {
  const settings = await getSettings();
  if (!settings.aiLocatorEnabled) {
    return {
      ok: false,
      message: 'AI 辅助定位未开启',
    };
  }

  const apiKey = String(settings.openAIApiKey || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      message: 'AI 辅助定位已开启，但未填写 OpenAI API Key',
    };
  }

  const baseUrl = normalizeOpenAIBaseUrl(settings.openAIBaseUrl);
  const model = String(settings.openAIModel || DEFAULT_SETTINGS.openAIModel).trim() || DEFAULT_SETTINGS.openAIModel;
  const responsesUrl = buildResponsesUrl(baseUrl);
  await ensureHostPermissionForUrl(responsesUrl);

  const targetViewLabel = payload.targetView === 'top' ? '热门 / Top' : '搜索量上升 / Rising';
  const prompt = [
    '你是 Google Trends 页面操作助手。',
    `任务：从当前打开的下拉选项里，选出最符合目标视图“${targetViewLabel}”的那一个。`,
    '要求：只返回 JSON，不要解释。',
    'JSON 结构：{"optionIndex": number, "confidence": number, "reason": string}',
    '规则：',
    '1. 只在给定 options 中选择。',
    '2. 如果目标是热门，优先选择 Top / 热门。',
    '3. 如果目标是上升，优先选择 Rising / 搜索量上升 / 上升。',
    '4. 如果没有可靠选项，返回 {"optionIndex": -1, "confidence": 0, "reason": "..."}。',
    '',
    `页面上下文：${JSON.stringify(payload.pageContext || {})}`,
    `下拉选项：${JSON.stringify(payload.options || [])}`,
  ].join('\n');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  let response;
  let data;

  try {
    response = await fetch(responsesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: prompt,
        text: {
          format: {
            type: 'json_object',
          },
        },
      }),
      signal: controller.signal,
    });
    data = await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('AI 视图切换请求超时（20 秒），已停止等待');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const apiMessage = data?.error?.message || `OpenAI 请求失败：HTTP ${response.status}`;
    throw new Error(apiMessage);
  }

  const rawText =
    data.output_text ||
    data.output?.[0]?.content?.find((item) => item.type === 'output_text')?.text ||
    '';

  if (!rawText) {
    throw new Error('OpenAI 没有返回可解析的视图切换结果');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`OpenAI 返回的 JSON 无法解析：${formatError(error)}`);
  }

  return {
    ok: true,
    optionIndex: Number.isInteger(parsed.optionIndex) ? parsed.optionIndex : -1,
    confidence: Number(parsed.confidence) || 0,
    reason: String(parsed.reason || ''),
    model,
  };
}

async function exportResults({ auto = false } = {}) {
  const state = await getState();
  if (!state.results.length) {
    throw new Error('当前还没有可导出的成功结果');
  }

  const csv = '\uFEFF' + buildCsv(state.results);
  await chrome.downloads.download({
    url: `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`,
    filename: `trendsspy-browser-report-${new Date().toISOString().slice(0, 10)}.csv`,
    saveAs: !auto,
  });
}

async function maybeAutoDownloadCsv(successMessage = '采集完成，已自动下载 CSV。') {
  const state = await getState();
  if (!state.autoDownloadCsv || !state.results.length) {
    return;
  }
  if (state.runId && state.lastAutoDownloadedRunId === state.runId) {
    return;
  }

  try {
    await exportResults({ auto: true });
    await patchState({
      lastAutoDownloadedRunId: state.runId || state.lastAutoDownloadedRunId,
      message: successMessage,
    });
  } catch (_) {}
}

async function fetchGoogleText(url, params) {
  const response = await fetch(`${url}?${params.toString()}`, {
    credentials: 'include',
    cache: 'no-store',
  });
  const text = await response.text();
  const verificationRequired = looksLikeCaptcha(response.url, text);

  if (verificationRequired) {
    return {
      blocked: true,
      blockType: 'captcha',
      url: response.url || url,
      status: response.status,
      text,
    };
  }

  if (response.status === 429) {
    return {
      blocked: true,
      blockType: 'rate_limited',
      url: response.url || url,
      status: response.status,
      text,
    };
  }

  if (!response.ok) {
    throw new Error(`请求失败：HTTP ${response.status}`);
  }

  return {
    blocked: false,
    url: response.url || url,
    status: response.status,
    text,
  };
}

async function fetchEmbedToken(keyword, timeframe, geo) {
  const response = await fetchGoogleText(EMBED_QUERIES_URL, buildExploreParams(keyword, timeframe, geo));
  if (response.blocked) {
    return response;
  }
  const tokenData = extractEmbeddedData(response.text);
  return {
    blocked: false,
    request: tokenData.request,
    token: tokenData.token,
    url: response.url,
  };
}

async function fetchRelatedQueries(request, token) {
  const params = new URLSearchParams({
    req: JSON.stringify(request),
    token,
    hl: 'en',
    tz: getTimeZoneMinutes(),
  });
  const response = await fetchGoogleText(API_RELATED_QUERIES_URL, params);
  if (response.blocked) {
    return response;
  }
  return {
    blocked: false,
    url: response.url,
    data: parseGoogleJsonPayload(response.text),
  };
}

async function ensureTrackedTab(fieldName, url, options = {}) {
  const { activeOnCreate = false, activeOnUpdate = false } = options;
  const state = await getState();
  const tabId = state[fieldName];

  if (tabId) {
    try {
      const updateProperties = { url };
      if (activeOnUpdate) {
        updateProperties.active = true;
      }
      const tab = await chrome.tabs.update(tabId, updateProperties);
      await patchState({ [fieldName]: tab.id });
      return tab;
    } catch (_) {}
  }

  const createProperties = { url, active: activeOnCreate };
  const tab = await chrome.tabs.create(createProperties);
  await patchState({ [fieldName]: tab.id });
  return tab;
}

async function ensureCaptchaTab(url, existingTabId = null) {
  const targetUrl = url || 'https://trends.google.com/trends/explore';
  if (existingTabId) {
    try {
      const tab = await chrome.tabs.update(existingTabId, { active: true });
      await patchState({ captchaTabId: tab.id });
      return tab;
    } catch (_) {}
  }
  return ensureTrackedTab('captchaTabId', targetUrl, {
    activeOnCreate: true,
    activeOnUpdate: true,
  });
}

async function ensurePageTab(url, activateVisible = false) {
  const state = await getState();
  const shouldActivateUpdate = activateVisible && Boolean(state.pageTabId);
  return ensureTrackedTab('pageTabId', url, {
    activeOnCreate: true,
    activeOnUpdate: shouldActivateUpdate,
  });
}

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        return tab;
      }
    } catch (error) {
      throw new Error(`页面标签页不可用：${formatError(error)}`);
    }
    await sleep(300);
  }
  throw new Error('等待页面加载超时');
}

async function waitForContentScriptReady(tabId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
      if (response?.ok) {
        return;
      }
    } catch (_) {}
    await sleep(300);
  }
  throw new Error('页面脚本未就绪，请确认 Trends 页面已打开完成');
}

async function scheduleNext(delayMs, nextKeyword) {
  const nextRunAt = Date.now() + delayMs;
  await chrome.alarms.clear(NEXT_FETCH_ALARM);
  await chrome.alarms.create(NEXT_FETCH_ALARM, { when: nextRunAt });
  await patchState({
    currentStage: '等待下一个关键词',
    currentKeyword: nextKeyword || '',
    message: `等待下一个关键词（约 ${Math.ceil(delayMs / 1000)} 秒）`,
    nextRunAt,
    lastError: '',
  });
}

async function finishRun(status = 'completed', options = {}) {
  const { lastError = '', message = '', currentStage = '' } = options;
  const defaultStage = {
    idle: '准备开始',
    paused: '已暂停',
    completed: '采集完成',
    terminated: '本轮已结束',
    error: '运行出错',
    captcha: '等待人工验证',
  };

  const state = await getState();
  await chrome.alarms.clear(NEXT_FETCH_ALARM);
  await patchState({
    status,
    captcha: status === 'captcha' ? state.captcha : null,
    lastError,
    message: message || lastError || (status === 'completed' ? '采集完成，可以导出 CSV。' : '任务已停止。'),
    currentStage: currentStage || defaultStage[status] || status,
    nextRunAt: null,
    currentKeyword: ['completed', 'terminated', 'idle'].includes(status) ? '' : state.currentKeyword,
  });
}

async function terminateCurrentRun() {
  const state = await getState();
  await chrome.alarms.clear(NEXT_FETCH_ALARM);

  await patchState({
    status: 'terminated',
    currentStage: '本轮已结束',
    message: state.results.length ? '本轮任务已结束，已保留当前成功结果。' : '本轮任务已结束。',
    nextRunAt: null,
    captcha: null,
  });

  await maybeAutoDownloadCsv('本轮任务已结束，已自动下载 CSV。');
  return getState();
}

async function enterCaptchaState(keyword, url, message, options = {}) {
  const { existingTabId = null } = options;
  const manualUrl = String(url || '').includes('/sorry')
    ? url
    : 'https://trends.google.com/trends/explore';
  const tab = await ensureCaptchaTab(manualUrl, existingTabId);
  const notice = message || '检测到 Google 人机验证，请先手动完成验证。';
  return patchState({
    status: 'captcha',
    captcha: {
      keyword,
      url: tab.url || manualUrl,
      message: notice,
    },
    currentKeyword: keyword,
    currentStage: '等待人工验证',
    message: `${notice} 已打开验证页面。验证完成后，回到插件点击“验证后继续”。`,
    lastError: '',
    nextRunAt: null,
  });
}

async function pauseForRateLimit(keyword, phase, response) {
  const phaseLabel = phase || '当前请求';
  const detail = `Google Trends 返回 HTTP ${response.status}，这是限流，不是验证码。建议把间隔调大到 30-60 秒后，再点击“继续”重试当前关键词。`;
  await patchState({
    status: 'paused',
    currentKeyword: keyword,
    currentStage: '触发限流',
    message: `${phaseLabel}触发限流。${detail}`,
    lastError: `${phaseLabel}触发限流：HTTP ${response.status}`,
    nextRunAt: null,
    captcha: null,
  });
}

async function activateHybridFallback(keyword, reason) {
  await patchState({
    fallbackActivated: true,
    currentKeyword: keyword,
    currentStage: '切换到页面模式',
    message: `API 模式触发限流，剩余关键词改走页面模式。${reason}`,
    lastError: '',
    nextRunAt: null,
  });
  setTimeout(() => {
    processQueue();
  }, 0);
}

async function recordKeywordError(keyword, errorMessage) {
  const liveState = await getState();
  const nextErrors = liveState.errors.concat({
    keyword,
    message: errorMessage,
    capturedAt: nowIso(),
  });
  const nextIndex = liveState.currentIndex + 1;
  const nextKeyword = liveState.queue[nextIndex] || '';
  await patchState({
    errors: nextErrors,
    currentIndex: nextIndex,
    currentKeyword: nextKeyword,
    currentStage: '记录错误',
    message: `关键词“${keyword}”抓取失败：${errorMessage}`,
    lastError: errorMessage,
    nextRunAt: null,
  });

  if (nextIndex >= liveState.queue.length) {
    await finishRun('completed', {
      lastError: errorMessage,
      message: `采集完成，部分关键词失败。最后错误：${errorMessage}`,
      currentStage: '采集完成',
    });
    await maybeAutoDownloadCsv('采集完成，已自动下载 CSV。');
    return;
  }

  if ((await getState()).status === 'running') {
    await scheduleNext(randomDelayMs(liveState.minDelaySeconds, liveState.maxDelaySeconds), nextKeyword);
  }
}

async function recordKeywordSuccess(keyword, items, sourceUrl, mode) {
  const liveState = await getState();
  const nextResults = liveState.results.concat(
    items.map((item) => ({
      keyword,
      relatedQuery: item.relatedQuery,
      value: item.value,
      type: item.type,
      sourceUrl,
      fetchMode: mode,
      capturedAt: nowIso(),
    }))
  );
  const nextIndex = liveState.currentIndex + 1;
  const nextKeyword = liveState.queue[nextIndex] || '';

  await patchState({
    results: nextResults,
    currentIndex: nextIndex,
    captcha: null,
    currentKeyword: nextKeyword,
    currentStage: '保存结果',
    message: items.length
      ? `关键词“${keyword}”完成，新增 ${items.length} 条结果。`
      : `关键词“${keyword}”完成，但没有返回 related queries。`,
    lastError: '',
    nextRunAt: null,
  });

  if (nextIndex >= liveState.queue.length) {
    await finishRun('completed', {
      message: '采集完成，可以导出 CSV。',
      currentStage: '采集完成',
    });
    await maybeAutoDownloadCsv('采集完成，已自动下载 CSV。');
    return;
  }

  if ((await getState()).status === 'running') {
    await scheduleNext(randomDelayMs(liveState.minDelaySeconds, liveState.maxDelaySeconds), nextKeyword);
  }
}

async function collectKeywordViaApi(state, keyword) {
  await patchState({
    currentKeyword: keyword,
    currentStage: 'API 模式：请求 embed token',
    message: `API 模式正在请求关键词“${keyword}”的 embed token。`,
    lastError: '',
    nextRunAt: null,
  });

  const embedToken = await fetchEmbedToken(keyword, state.timeframe, state.geo);
  if (embedToken.blocked) {
    return {
      kind: embedToken.blockType,
      phase: '获取 embed token 时',
      response: embedToken,
      message:
        embedToken.blockType === 'captcha'
          ? 'Google 在获取 embed token 时要求进行人工验证。'
          : `API 模式在获取 embed token 时被限流（HTTP ${embedToken.status}）。`,
    };
  }

  await patchState({
    currentKeyword: keyword,
    currentStage: 'API 模式：请求 related queries',
    message: `API 模式已拿到关键词“${keyword}”的 token，正在请求 related queries 数据。`,
    lastError: '',
  });

  const relatedQueries = await fetchRelatedQueries(embedToken.request, embedToken.token);
  if (relatedQueries.blocked) {
    return {
      kind: relatedQueries.blockType,
      phase: '请求 related queries 数据时',
      response: relatedQueries,
      message:
        relatedQueries.blockType === 'captcha'
          ? 'Google 在请求 related queries 数据时要求进行人工验证。'
          : `API 模式在请求 related queries 数据时被限流（HTTP ${relatedQueries.status}）。`,
    };
  }

  return {
    kind: 'success',
    items: parseRelatedQueriesData(relatedQueries.data),
    sourceUrl: relatedQueries.url,
    mode: 'api',
  };
}

async function collectKeywordViaPage(state, keyword) {
  const settings = await getSettings();
  const pageUrl = buildExploreUrl(keyword, state.timeframe, state.geo);
  const activateVisible = state.fetchMode === 'page' || !state.pageTabId;

  await patchState({
    currentKeyword: keyword,
    currentStage: '页面模式：打开 Trends 页面',
    message: `页面模式正在打开关键词“${keyword}”的 Trends 页面。`,
    lastError: '',
    nextRunAt: null,
  });

  const tab = await ensurePageTab(pageUrl, activateVisible);
  await waitForTabComplete(tab.id);
  await waitForContentScriptReady(tab.id);

  await patchState({
    currentKeyword: keyword,
    currentStage: '页面模式：翻页采集',
    message: settings.aiLocatorEnabled
      ? `页面模式正在采集关键词“${keyword}”，AI 将严格定位“相关查询”卡片；若未命中会直接失败。`
      : `页面模式正在采集关键词“${keyword}”，当前使用规则定位“相关查询”卡片。`,
    lastError: '',
  });

  const response = await chrome.tabs.sendMessage(tab.id, {
    type: 'collectRelatedQueriesFromPage',
    payload: {
      keyword,
      timeframe: state.timeframe,
      geo: state.geo,
      aiLocatorEnabled: Boolean(settings.aiLocatorEnabled),
    },
  });

  if (!response?.ok) {
    throw new Error(response?.message || '页面模式返回了空响应');
  }

  if (response.blocked) {
    return {
      kind: response.blockType,
      response: {
        status: response.status || 0,
        url: response.url || pageUrl,
      },
      message: response.message || '页面模式被拦截',
      existingTabId: tab.id,
    };
  }

  return {
    kind: 'success',
    items: response.items || [],
    sourceUrl: response.url || pageUrl,
    mode: 'page',
  };
}

async function processQueue() {
  if (processing) {
    return;
  }
  processing = true;

  try {
    const state = await getState();
    if (state.status !== 'running') {
      return;
    }

    if (state.currentIndex >= state.queue.length) {
      await finishRun('completed', {
        message: '采集完成，可以导出 CSV。',
        currentStage: '采集完成',
      });
      await maybeAutoDownloadCsv('采集完成，已自动下载 CSV。');
      return;
    }

    const keyword = state.queue[state.currentIndex];
    const activeMode = resolveActiveMode(state);
    const result =
      activeMode === 'page'
        ? await collectKeywordViaPage(state, keyword)
        : await collectKeywordViaApi(state, keyword);

    if (result.kind === 'success') {
      await recordKeywordSuccess(keyword, result.items, result.sourceUrl, result.mode);
      return;
    }

    if (result.kind === 'captcha') {
      await enterCaptchaState(
        keyword,
        result.response?.url,
        result.message,
        { existingTabId: result.existingTabId || null }
      );
      return;
    }

    if (result.kind === 'rate_limited') {
      const latestState = await getState();
      if (latestState.fetchMode === 'hybrid' && !latestState.fallbackActivated) {
        await activateHybridFallback(
          keyword,
          '当前关键词和后续关键词都会切到页面模式。'
        );
        return;
      }
      await pauseForRateLimit(keyword, result.phase, result.response || { status: 429 });
      return;
    }

    await recordKeywordError(keyword, result.message || '未知错误');
  } catch (error) {
    const state = await getState();
    const keyword = state.queue[state.currentIndex] || state.currentKeyword || '未知关键词';
    await recordKeywordError(keyword, formatError(error));
  } finally {
    processing = false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === NEXT_FETCH_ALARM) {
    processQueue();
  }
});

// 点击插件图标 → 在当前 tab 注入/切换抽屉
chrome.action.onClicked.addListener((tab) => {
  const url = tab.url || '';
  const isSystemPage = !url || /^(chrome|edge|about|data):/.test(url);

  if (isSystemPage) {
    // 系统页无法注入，改为打开 Google Trends 并注入
    chrome.tabs.create({ url: 'https://trends.google.com' }, (newTab) => {
      const inject = () => {
        chrome.scripting.executeScript({
          target: { tabId: newTab.id },
          files: ['drawer.js'],
        }).catch((err) => {
          console.error('[TrendsSpy] inject failed:', err?.message || err);
        });
      };
      // 等页面加载完成再注入
      const onUpdated = (tabId, info) => {
        if (tabId === newTab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          inject();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
    return;
  }

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['drawer.js'],
  }).catch((err) => {
    console.error('[TrendsSpy] inject failed:', err?.message || err);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  (async () => {
    const state = await getState();
    const nextPartial = {};
    if (state.pageTabId === tabId) {
      nextPartial.pageTabId = null;
    }
    if (state.captchaTabId === tabId) {
      nextPartial.captchaTabId = null;
    }
    if (Object.keys(nextPartial).length) {
      await patchState(nextPartial);
    }
  })();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
    if (message.type === 'getState') {
      sendResponse({ ok: true, state: await getState(), settings: await getSettings() });
      return;
    }

    if (message.type === 'startRun') {
      const current = await getState();
      const keywords = (message.payload.keywords || [])
        .map((keyword) => keyword.trim())
        .filter(Boolean);
      const fetchMode = normalizeFetchMode(message.payload.fetchMode);

      const nextState = await saveState({
        ...DEFAULTS,
        captchaTabId: current.captchaTabId,
        pageTabId: current.pageTabId,
        autoDownloadCsv: current.autoDownloadCsv,
        lastAutoDownloadedRunId: current.lastAutoDownloadedRunId,
        queue: keywords,
        timeframe: message.payload.timeframe || DEFAULTS.timeframe,
        geo: message.payload.geo || '',
        minDelaySeconds: Number(message.payload.minDelaySeconds) || DEFAULTS.minDelaySeconds,
        maxDelaySeconds: Number(message.payload.maxDelaySeconds) || DEFAULTS.maxDelaySeconds,
        fetchMode,
        fallbackActivated: false,
        queryTypeLabel: '全部',
        status: keywords.length ? 'running' : 'idle',
        currentKeyword: keywords[0] || '',
        currentStage: keywords.length ? '准备启动' : '准备开始',
        message: keywords.length
          ? `${getFetchModeLabel(fetchMode)}已启动，准备请求第一个关键词。`
          : '请先输入至少一个关键词。',
        runId: nowIso(),
      });

      if (keywords.length) {
        processQueue();
      }

      sendResponse({ ok: true, state: nextState });
      return;
    }

    if (message.type === 'pauseRun') {
      await chrome.alarms.clear(NEXT_FETCH_ALARM);
      sendResponse({
        ok: true,
        state: await patchState({
          status: 'paused',
          currentStage: '已暂停',
          message: '任务已暂停。',
          nextRunAt: null,
        }),
      });
      return;
    }

    if (message.type === 'resumeRun') {
      const state = await patchState({
        status: 'running',
        currentStage: '恢复中',
        message: '任务恢复中，准备继续请求。',
        lastError: '',
        nextRunAt: null,
      });
      processQueue();
      sendResponse({ ok: true, state });
      return;
    }

    if (message.type === 'continueAfterCaptcha') {
      const state = await patchState({
        status: 'running',
        captcha: null,
        currentStage: '恢复中',
        message: '已收到继续指令，准备重新请求当前关键词。',
        lastError: '',
        nextRunAt: null,
      });
      processQueue();
      sendResponse({ ok: true, state });
      return;
    }

    if (message.type === 'clearResults') {
      sendResponse({ ok: true, state: await resetRunState() });
      return;
    }

    if (message.type === 'terminateRun') {
      sendResponse({ ok: true, state: await terminateCurrentRun() });
      return;
    }

    if (message.type === 'updateDownloadSettings') {
      const state = await patchState({
        autoDownloadCsv: Boolean(message.payload.autoDownloadCsv),
      });
      sendResponse({ ok: true, state });
      return;
    }

    if (message.type === 'updateAiSettings') {
      const settings = await patchSettings({
        aiLocatorEnabled: Boolean(message.payload.aiLocatorEnabled),
        openAIApiKey: String(message.payload.openAIApiKey || ''),
        openAIBaseUrl: normalizeOpenAIBaseUrl(message.payload.openAIBaseUrl || DEFAULT_SETTINGS.openAIBaseUrl),
        openAIModel: String(message.payload.openAIModel || DEFAULT_SETTINGS.openAIModel).trim() || DEFAULT_SETTINGS.openAIModel,
      });
      sendResponse({ ok: true, settings });
      return;
    }

    if (message.type === 'pageCollectionProgress') {
      const liveState = await getState();
      if (liveState.status === 'running') {
        await patchState({
          currentStage: message.payload.stage || liveState.currentStage,
          message: message.payload.message || liveState.message,
        });
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'aiLocateWidget') {
      sendResponse(await locateWidgetWithOpenAI(message.payload || {}));
      return;
    }

    if (message.type === 'aiChooseViewOption') {
      sendResponse(await chooseViewOptionWithOpenAI(message.payload || {}));
      return;
    }

    if (message.type === 'testAiConnection') {
      try {
        const settings = await getSettings();
        const apiKey = String(settings.openAIApiKey || '').trim();
        if (!apiKey) {
          sendResponse({ ok: false, message: 'API Key \u672a\u586b\u5199' });
          return;
        }
        const baseUrl = normalizeOpenAIBaseUrl(settings.openAIBaseUrl);
        const model = String(settings.openAIModel || DEFAULT_SETTINGS.openAIModel).trim() || DEFAULT_SETTINGS.openAIModel;
        const responsesUrl = buildResponsesUrl(baseUrl);
        await ensureHostPermissionForUrl(responsesUrl);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        let response, data;
        try {
          response = await fetch(responsesUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              input: 'Reply with "ok" only.',
              text: { format: { type: 'text' } },
            }),
            signal: controller.signal,
          });
          data = await response.json();
        } finally {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          const msg = data?.error?.message || `HTTP ${response.status}`;
          sendResponse({ ok: false, message: `\u8bf7\u6c42\u5931\u8d25\uff1a${msg}` });
          return;
        }

        const text =
          data.output_text ||
          data.output?.[0]?.content?.find((item) => item.type === 'output_text')?.text ||
          '(no output)';
        sendResponse({ ok: true, message: `\u8fde\u63a5\u6210\u529f\uff0c\u6a21\u578b\u56de\u590d\uff1a${text.slice(0, 80)}` });
      } catch (error) {
        const msg = error?.name === 'AbortError' ? '\u8bf7\u6c42\u8d85\u65f6\uff0815 \u79d2\uff09' : formatError(error);
        sendResponse({ ok: false, message: msg });
      }
      return;
    }

    if (message.type === 'exportResults') {
      await exportResults();
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: 'unknown_message' });
    } catch (error) {
      sendResponse({ ok: false, message: formatError(error) });
    }
  })();

  return true;
});
