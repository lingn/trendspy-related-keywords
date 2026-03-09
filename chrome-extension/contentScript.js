const VIEW_LABELS = {
  top: ['热门', 'Top'],
  rising: ['搜索量上升', '上升', 'Rising'],
};

const NO_DATA_MESSAGES = [
  '没有足够的相关数据',
  '无法显示在此处',
  "didn't have enough data",
  'Not enough search volume',
];

const PAGE_ERROR_MESSAGES = [
  '糟糕！出了点问题',
  '请稍后重试',
  'Sorry, something went wrong',
  'Try again later',
];

const RELATED_QUERIES_HEADINGS = ['相关查询', 'Related queries'];
const RELATED_TOPICS_HEADINGS = ['相关主题', 'Related topics'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendRuntimeMessage(message) {
  try {
    return Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => null);
  } catch (_) {
    return Promise.resolve(null);
  }
}

function reportProgress(stage, message) {
  void sendRuntimeMessage({
    type: 'pageCollectionProgress',
    payload: {
      stage,
      message,
    },
  });
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function matchesExactText(text, candidates) {
  const normalized = normalizeText(text);
  return candidates.includes(normalized);
}

function startsWithCandidate(text, candidates) {
  const normalized = normalizeText(text);
  return candidates.some((candidate) => normalized.startsWith(candidate));
}

function getPageText() {
  return normalizeText(document.body?.innerText || '');
}

function looksLikeCaptchaPage() {
  const text = getPageText().toLowerCase();
  const url = window.location.href.toLowerCase();
  return (
    url.includes('/sorry') ||
    text.includes('unusual traffic') ||
    text.includes('recaptcha') ||
    text.includes('人机验证') ||
    text.includes('验证您是真人') ||
    text.includes('press and hold')
  );
}

function getRelatedQueriesTextSlice() {
  const pageText = document.body?.innerText || '';
  const markers = ['相关查询', 'Related queries'];
  const start = markers
    .map((marker) => pageText.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (start === undefined) {
    return '';
  }
  return pageText.slice(start, start + 4000);
}

function findRelatedQueriesWidget() {
  const exactHeading = Array.from(document.querySelectorAll('*')).find((element) => {
    return startsWithCandidate(element.textContent, RELATED_QUERIES_HEADINGS);
  });

  if (exactHeading) {
    let current = exactHeading.parentElement;
    while (current) {
      const selector = current.querySelector('md-select.bullets-view-selector');
      if (selector) {
        return current;
      }
      current = current.parentElement;
    }
  }

  return null;
}

function collectWidgetCandidates() {
  const candidates = [];
  const seen = new Set();

  Array.from(document.querySelectorAll('md-select.bullets-view-selector')).forEach((selector) => {
    let root = selector;
    while (root) {
      const signature = `${root.tagName}:${normalizeText(root.innerText).slice(0, 120)}`;
      const text = normalizeText(root.innerText || '');
      const hasItems = root.querySelector('.item');
      const paginationText = getPaginationText(root);
      if ((hasItems || paginationText) && !seen.has(signature)) {
        const heading = Array.from(root.querySelectorAll('*'))
          .map((element) => normalizeText(element.textContent))
          .find((item) =>
            startsWithCandidate(item, [...RELATED_QUERIES_HEADINGS, ...RELATED_TOPICS_HEADINGS])
          ) || '';

        if (!heading) {
          break;
        }

        seen.add(signature);
        candidates.push({
          element: root,
          summary: {
            widgetIndex: candidates.length,
            heading,
            paginationText,
            sampleItems: Array.from(root.querySelectorAll('.item .label-text'))
              .slice(0, 3)
              .map((element) => normalizeText(element.textContent)),
            textSnippet: text.slice(0, 400),
          },
        });
        break;
      }
      root = root.parentElement;
    }
  });

  return candidates;
}

// 宽松候选收集：不依赖 md-select，通过标题文本向上找容器，作为 AI 的兜底输入
function collectBroadWidgetCandidates() {
  const seenElements = new Set();
  const candidates = [];

  // 找所有文本以"相关查询"/"Related queries"开头的叶子/小节点，向上找合适容器
  Array.from(document.querySelectorAll('*')).forEach((element) => {
    if (!startsWithCandidate(element.textContent, [
      ...RELATED_QUERIES_HEADINGS,
      ...RELATED_TOPICS_HEADINGS,
    ])) {
      return;
    }

    // 只取文本节点较纯粹的元素（自身子元素少，说明是标题节点而非大容器）
    if (element.querySelectorAll('*').length > 10) {
      return;
    }

    const heading = normalizeText(element.textContent);

    // 向上最多遍历 12 层，找第一个"够大"的容器作为候选
    let current = element.parentElement;
    let depth = 0;
    while (current && depth < 12) {
      if (seenElements.has(current)) {
        break;
      }
      const childCount = current.querySelectorAll('*').length;
      if (childCount >= 8) {
        seenElements.add(current);
        const text = normalizeText(current.innerText || '');
        const paginationText = getPaginationText(current);

        // 宽松取样：优先 .item .label-text，没有则取链接或列表项文字
        const strictSamples = Array.from(current.querySelectorAll('.item .label-text'))
          .slice(0, 3)
          .map((el) => normalizeText(el.textContent));
        const looseSamples = strictSamples.length
          ? strictSamples
          : Array.from(current.querySelectorAll('a, li'))
              .slice(0, 3)
              .map((el) => normalizeText(el.textContent))
              .filter(Boolean);

        candidates.push({
          element: current,
          summary: {
            widgetIndex: candidates.length,
            heading,
            paginationText,
            sampleItems: looseSamples,
            textSnippet: text.slice(0, 400),
          },
        });
        break;
      }
      current = current.parentElement;
      depth += 1;
    }
  });

  return candidates;
}

async function ensureRelatedSectionsRendered(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let scrollAttempt = 0;

  while (Date.now() < deadline) {
    const pageText = document.body?.innerText || '';
    const hasRelatedQueries = RELATED_QUERIES_HEADINGS.some((heading) => pageText.includes(heading));
    if (hasRelatedQueries) {
      return true;
    }

    const nextY = Math.min(
      document.documentElement.scrollHeight,
      Math.round(window.scrollY + window.innerHeight * 0.9)
    );
    window.scrollTo({
      top: nextY,
      behavior: 'instant',
    });
    scrollAttempt += 1;
    reportProgress(
      '页面模式：触发懒加载',
      `页面模式正在向下滚动以加载“相关查询”区域（第 ${scrollAttempt} 次）。`
    );
    await sleep(800);
  }

  return false;
}

function hasNoData(widget) {
  const text = normalizeText(widget?.innerText || getRelatedQueriesTextSlice());
  return NO_DATA_MESSAGES.some((message) => text.includes(message));
}

function getPageLevelError() {
  const text = getPageText();
  return PAGE_ERROR_MESSAGES.find((message) => text.includes(message)) || '';
}

function getModeSelector(widget) {
  return widget?.querySelector('md-select.bullets-view-selector') || null;
}

function triggerElementClick(element) {
  if (!element) {
    return false;
  }

  const target = element.querySelector?.('[role="button"], button, .md-select-value, .md-text') || element;
  const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
  const view = element.ownerDocument?.defaultView || window;

  target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  target.focus?.({ preventScroll: true });

  for (const eventName of events) {
    const EventCtor = eventName.startsWith('pointer') ? view.PointerEvent : view.MouseEvent;
    target.dispatchEvent(
      new EventCtor(eventName, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view,
      })
    );
  }

  try {
    target.click?.();
  } catch (_) {}

  return true;
}

function getVisibleOptionElements() {
  return Array.from(document.querySelectorAll('md-option,[role="option"]')).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

function getVisibleViewOptions(view) {
  return getVisibleOptionElements().filter((element) => matchesView(element.textContent, view));
}

function summarizeViewOption(option, optionIndex) {
  return {
    optionIndex,
    text: normalizeText(option.textContent),
    ariaLabel: normalizeText(option.getAttribute('aria-label')),
    title: normalizeText(option.getAttribute('title')),
    className: normalizeText(option.className),
  };
}

async function chooseViewOptionWithAI(selector, widget, view) {
  const visibleOptions = getVisibleOptionElements();
  if (!visibleOptions.length) {
    return { ok: false, message: 'AI 切换失败：当前没有可见的下拉选项' };
  }

  const response = await sendRuntimeMessage({
    type: 'aiChooseViewOption',
    payload: {
      targetView: view,
      pageContext: {
        url: window.location.href,
        title: document.title,
        selectorText: getModeSelectorCurrentText(selector),
        inferredView: inferViewFromItems(widget),
        firstItem: getFirstItemSignature(widget),
        paginationText: getPaginationText(widget),
      },
      options: visibleOptions.map((option, optionIndex) => summarizeViewOption(option, optionIndex)),
    },
  });

  if (!response?.ok) {
    return {
      ok: false,
      message: response?.message || 'AI 切换失败：模型没有返回可用选项',
    };
  }

  const chosen = visibleOptions[response.optionIndex];
  if (!chosen) {
    return {
      ok: false,
      message: `AI 切换失败：模型返回了不存在的选项编号 ${response.optionIndex}`,
    };
  }

  return {
    ok: true,
    option: chosen,
    reason: response.reason || '',
  };
}

function inferViewFromItems(widget) {
  const values = Array.from(widget?.querySelectorAll('.item .rising-value, .item .progress-value, .item .value'))
    .slice(0, 5)
    .map((element) => normalizeText(element.textContent))
    .filter(Boolean);

  if (!values.length) {
    return '';
  }

  const risingHints = ['%', 'Breakout', '突增'];
  const risingCount = values.filter((value) => risingHints.some((hint) => value.includes(hint))).length;
  if (risingCount >= Math.ceil(values.length / 2)) {
    return 'rising';
  }

  const topCount = values.filter((value) => /^<?\d+(?:\.\d+)?$/.test(value)).length;
  if (topCount >= Math.ceil(values.length / 2)) {
    return 'top';
  }

  return '';
}

function getModeSelectorCurrentText(selector) {
  if (!selector) {
    return '';
  }

  const allViewLabels = [...new Set(Object.values(VIEW_LABELS).flat())];
  const rawCandidates = [
    selector.getAttribute('aria-label'),
    selector.getAttribute('title'),
    selector.querySelector('.md-text')?.textContent,
    selector.querySelector('.md-select-value')?.textContent,
    ...Array.from(selector.querySelectorAll('*')).map((element) => element.textContent),
    selector.textContent,
  ];

  const candidates = rawCandidates.map(normalizeText).filter(Boolean);

  for (const label of allViewLabels) {
    const exactMatch = candidates.find((candidate) => candidate === label);
    if (exactMatch) {
      return exactMatch;
    }
  }

  return (
    candidates.find((candidate) => allViewLabels.some((label) => candidate.includes(label))) || ''
  );
}

function matchesView(text, view) {
  return VIEW_LABELS[view].some((label) => normalizeText(text).toLowerCase().includes(label.toLowerCase()));
}

function getPaginationText(widget) {
  const text = normalizeText(widget?.innerText || '');
  const match =
    text.match(/当前显示的是第\s*\d+\s*-\s*\d+\s*个查询（共\s*\d+\s*个）/) ||
    text.match(/Showing\s*\d+\s*-\s*\d+\s*of\s*\d+/i);
  return match ? match[0] : '';
}

function getButtonByAria(widget, labels) {
  const all = Array.from((widget || document).querySelectorAll('button,[role="button"]'));
  return (
    all.find((element) => {
      const joined = [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent]
        .map(normalizeText)
        .join(' ');
      return labels.some((label) => joined.toLowerCase().includes(label.toLowerCase()));
    }) || null
  );
}

function isDisabled(element) {
  return Boolean(
    element &&
      (element.disabled ||
        element.getAttribute('disabled') !== null ||
        element.getAttribute('aria-disabled') === 'true')
  );
}

function getFirstItemSignature(widget) {
  const firstItem = widget?.querySelector('.item');
  return firstItem ? normalizeText(firstItem.textContent) : '';
}

function parseItems(widget, type) {
  const seen = new Set();
  return Array.from(widget.querySelectorAll('.item'))
    .map((item) => {
      const relatedQuery = normalizeText(item.querySelector('.label-text')?.textContent || '');
      const value = normalizeText(
        item.querySelector('.rising-value, .progress-value, .value')?.textContent || ''
      );
      return {
        relatedQuery,
        value,
        type,
      };
    })
    .filter((item) => {
      if (!item.relatedQuery) {
        return false;
      }
      const key = `${item.type}::${item.relatedQuery}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

async function waitFor(checker, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = checker();
    if (value) {
      return value;
    }
    await sleep(intervalMs);
  }
  return null;
}

async function waitForRelatedQueriesWidget(timeoutMs = 45000) {
  const rendered = await ensureRelatedSectionsRendered(Math.min(timeoutMs, 30000));
  if (!rendered) {
    return {
      kind: 'error',
      message: '页面没有加载出“相关查询”卡片，已停止抓取',
    };
  }

  reportProgress('页面模式：等待卡片加载', '页面模式正在等待“相关查询”卡片加载。');
  const widget = await waitFor(() => {
    if (looksLikeCaptchaPage()) {
      return { kind: 'captcha' };
    }

    const foundWidget = findRelatedQueriesWidget();
    if (foundWidget && (foundWidget.querySelector('.item') || hasNoData(foundWidget))) {
      return { kind: 'ready', widget: foundWidget };
    }

    const relatedText = getRelatedQueriesTextSlice();
    if (relatedText && NO_DATA_MESSAGES.some((message) => relatedText.includes(message))) {
      return { kind: 'empty' };
    }

    return null;
  }, timeoutMs);

  if (widget) {
    return widget;
  }

  if (looksLikeCaptchaPage()) {
    return { kind: 'captcha' };
  }

  const pageError = getPageLevelError();
  if (pageError) {
    return { kind: 'error', message: pageError };
  }

  // 文字已出现但规则找不到结构 → rule_failed，让 AI 有机会接手
  return {
    kind: 'rule_failed',
    message: '页面已显示”相关查询”文本，但规则未能定位卡片结构',
  };
}

async function ensureBulletsView(widget, view, aiLocatorEnabled = false) {
  const selector = getModeSelector(widget);
  if (!selector) {
    return;
  }

  const currentViewText = getModeSelectorCurrentText(selector);
  const inferredView = inferViewFromItems(widget);
  if (matchesView(currentViewText, view) && (!inferredView || inferredView === view)) {
    return;
  }

  reportProgress(
    '页面模式：切换视图',
    `页面模式正在切换到“${view === 'top' ? '热门' : '上升'}”视图。`
  );

  const beforeSignature = getFirstItemSignature(widget) || getPaginationText(widget);
  let switched = false;

  for (let attempt = 0; attempt < 2 && !switched; attempt += 1) {
    triggerElementClick(selector);
    const option = await waitFor(() => getVisibleViewOptions(view)[0], 3000, 150);

    if (!option) {
      continue;
    }

    triggerElementClick(option);

    switched = Boolean(
      await waitFor(() => {
        const nextViewText = getModeSelectorCurrentText(selector);
        const nextSignature = getFirstItemSignature(widget) || getPaginationText(widget);
        const nextInferredView = inferViewFromItems(widget);
        return (
          matchesView(nextViewText, view) &&
          ((nextSignature && nextSignature !== beforeSignature) || nextInferredView === view)
        );
      }, 5000, 150)
    );
  }

  if (!switched && aiLocatorEnabled) {
    reportProgress(
      '页面模式：AI 辅助切换视图',
      `规则点击未能切到“${view === 'top' ? '热门' : '上升'}”视图，正在让 AI 判断下拉项。`
    );

    triggerElementClick(selector);
    const ready = await waitFor(() => getVisibleOptionElements().length > 0, 3000, 150);
    if (ready) {
      const aiChoice = await chooseViewOptionWithAI(selector, widget, view);
      if (aiChoice.ok) {
        triggerElementClick(aiChoice.option);
        switched = Boolean(
          await waitFor(() => {
            const nextViewText = getModeSelectorCurrentText(selector);
            const nextSignature = getFirstItemSignature(widget) || getPaginationText(widget);
            const nextInferredView = inferViewFromItems(widget);
            return (
              matchesView(nextViewText, view) &&
              ((nextSignature && nextSignature !== beforeSignature) || nextInferredView === view)
            );
          }, 5000, 150)
        );
      } else {
        reportProgress('页面模式：AI 视图切换失败', aiChoice.message);
      }
    }
  }

  if (!switched) {
    throw new Error(`页面未成功切换到“${view === 'top' ? '热门' : '上升'}”视图`);
  }

  await sleep(400);
}

async function goToFirstPage(widget) {
  let guard = 0;
  while (guard < 20) {
    const previousButton = getButtonByAria(widget, ['Previous', '上一页']);
    if (!previousButton || isDisabled(previousButton)) {
      return;
    }
    reportProgress('页面模式：返回第一页', '页面模式正在回到分页的第一页。');
    const previousSignature = getPaginationText(widget) || getFirstItemSignature(widget);
    previousButton.click();
    await waitFor(() => {
      const currentSignature = getPaginationText(widget) || getFirstItemSignature(widget);
      return currentSignature && currentSignature !== previousSignature;
    }, 10000);
    await sleep(300);
    guard += 1;
  }
}

async function collectCurrentView(widget, view, options = {}) {
  widget.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });
  await sleep(400);
  await ensureBulletsView(widget, view, options.aiLocatorEnabled);
  await goToFirstPage(widget);

  if (hasNoData(widget)) {
    return [];
  }

  const type = view === 'top' ? '热门' : '上升';
  const results = [];
  const seen = new Set();
  let guard = 0;

  while (guard < 20) {
    reportProgress(
      '页面模式：读取分页',
      `页面模式正在读取“${view === 'top' ? '热门' : '上升'}”第 ${guard + 1} 页。`
    );
    const items = parseItems(widget, type);
    items.forEach((item) => {
      const key = `${item.type}::${item.relatedQuery}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(item);
      }
    });

    const nextButton = getButtonByAria(widget, ['Next', '下一页']);
    if (!nextButton || isDisabled(nextButton)) {
      break;
    }

    const previousSignature = getPaginationText(widget) || getFirstItemSignature(widget);
    reportProgress(
      '页面模式：翻到下一页',
      `页面模式正在翻到“${view === 'top' ? '热门' : '上升'}”下一页。`
    );
    nextButton.click();
    const changed = await waitFor(() => {
      const currentSignature = getPaginationText(widget) || getFirstItemSignature(widget);
      return currentSignature && currentSignature !== previousSignature;
    }, 10000);

    if (!changed) {
      break;
    }

    await sleep(300);
    guard += 1;
  }

  return results;
}

// AI 定位 helper：接收候选列表，调用 AI，返回选中的 element 或错误
async function locateWidgetWithAI(candidates, payload) {
  if (!candidates.length) {
    return { ok: false, message: 'AI 定位：页面里没有可供识别的候选卡片' };
  }

  reportProgress(
    '页面模式：AI 定位卡片',
    `AI 正在 ${candidates.length} 个候选卡片里严格定位”相关查询”卡片。`
  );

  let aiResponse;
  try {
    aiResponse = await sendRuntimeMessage({
      type: 'aiLocateWidget',
      payload: {
        pageContext: {
          url: window.location.href,
          title: document.title,
          keyword: payload.keyword || '',
        },
        candidates: candidates.map((candidate) => candidate.summary),
      },
    });
  } catch (error) {
    return {
      ok: false,
      message: `AI 定位请求失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!aiResponse?.ok) {
    return {
      ok: false,
      message: `AI 定位失败：${aiResponse?.message || '模型没有返回可用结果'}`,
    };
  }

  if (aiResponse.widgetIndex < 0) {
    return {
      ok: false,
      message: aiResponse.reason
        ? `AI 未确认任何”相关查询”卡片：${aiResponse.reason}`
        : 'AI 未确认任何”相关查询”卡片',
    };
  }

  const chosen = candidates.find((c) => c.summary.widgetIndex === aiResponse.widgetIndex);
  if (!chosen?.element) {
    return {
      ok: false,
      message: `AI 选中了不存在的候选卡片编号：${aiResponse.widgetIndex}`,
    };
  }

  if (!startsWithCandidate(chosen.summary.heading, RELATED_QUERIES_HEADINGS)) {
    return {
      ok: false,
      message: aiResponse.reason
        ? `AI 选中的不是”相关查询”卡片：${aiResponse.reason}`
        : 'AI 选中的不是”相关查询”卡片',
    };
  }

  reportProgress(
    '页面模式：AI 已定位卡片',
    `AI 已选择第 ${aiResponse.widgetIndex + 1} 个候选卡片${aiResponse.reason ? `：${aiResponse.reason}` : ''}`
  );

  return { ok: true, element: chosen.element };
}

async function collectRelatedQueriesFromPage(payload = {}) {
  const readyState = await waitForRelatedQueriesWidget();

  if (readyState.kind === 'captcha') {
    return {
      ok: true,
      blocked: true,
      blockType: 'captcha',
      url: window.location.href,
      message: '页面模式遇到 Google 人机验证，请先手动完成验证。',
    };
  }

  if (readyState.kind === 'empty') {
    return {
      ok: true,
      blocked: false,
      url: window.location.href,
      items: [],
    };
  }

  if (readyState.kind === 'error') {
    return {
      ok: false,
      message: readyState.message,
    };
  }

  // 规则失败（页面文字出现但结构找不到）→ AI 兜底，否则直接报错
  if (readyState.kind === 'rule_failed') {
    if (!payload.aiLocatorEnabled) {
      return {
        ok: false,
        message: `${readyState.message}。可开启 AI 辅助定位后重试。`,
      };
    }

    reportProgress(
      '页面模式：规则失败，启用 AI 兜底',
      '规则未能定位卡片，正在用宽松策略收集候选并交给 AI 识别。'
    );

    const broadCandidates = collectBroadWidgetCandidates();
    const aiResult = await locateWidgetWithAI(broadCandidates, payload);
    if (!aiResult.ok) {
      return { ok: false, message: aiResult.message };
    }

    const topItems = await collectCurrentView(aiResult.element, 'top', { aiLocatorEnabled: payload.aiLocatorEnabled });
    const risingItems = await collectCurrentView(aiResult.element, 'rising', { aiLocatorEnabled: payload.aiLocatorEnabled });
    return {
      ok: true,
      blocked: false,
      url: window.location.href,
      items: topItems.concat(risingItems),
    };
  }

  // kind === 'ready'：规则已找到 widget
  let widget = readyState.widget;
  if (!widget) {
    return {
      ok: false,
      message: '页面里没有找到 related queries 卡片',
    };
  }

  if (payload.aiLocatorEnabled) {
    // 优先用精确候选（依赖 md-select），为空则 fallback 到宽松候选
    let candidates = collectWidgetCandidates();
    if (!candidates.length) {
      reportProgress(
        '页面模式：AI 候选降级',
        '精确候选为空，改用宽松策略收集 AI 候选。'
      );
      candidates = collectBroadWidgetCandidates();
    }

    const aiResult = await locateWidgetWithAI(candidates, payload);
    if (!aiResult.ok) {
      return { ok: false, message: aiResult.message };
    }
    widget = aiResult.element;
  } else {
    reportProgress('页面模式：规则定位卡片', '当前未启用 AI，使用规则定位”相关查询”卡片。');
  }

  const headingText = Array.from(widget.querySelectorAll('*'))
    .map((element) => normalizeText(element.textContent))
    .find((item) => startsWithCandidate(item, RELATED_QUERIES_HEADINGS));
  if (!headingText) {
    return {
      ok: false,
      message: '最终命中的不是”相关查询”卡片，已中止本次抓取',
    };
  }

  const topItems = await collectCurrentView(widget, 'top', { aiLocatorEnabled: payload.aiLocatorEnabled });
  const risingItems = await collectCurrentView(widget, 'rising', { aiLocatorEnabled: payload.aiLocatorEnabled });

  return {
    ok: true,
    blocked: false,
    url: window.location.href,
    items: topItems.concat(risingItems),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === 'ping') {
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'collectRelatedQueriesFromPage') {
      sendResponse(await collectRelatedQueriesFromPage(message.payload || {}));
      return;
    }

    sendResponse({ ok: false, message: 'unknown_message' });
  })();

  return true;
});
