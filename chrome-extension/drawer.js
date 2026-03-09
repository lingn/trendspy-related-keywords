// 注入右侧常驻抽屉
(function () {
  const DRAWER_ID = 'trendspy-drawer';
  const IFRAME_ID = 'trendspy-drawer-iframe';
  const TOGGLE_BTN_ID = 'trendspy-drawer-toggle';

  const POPUP_URL = chrome.runtime.getURL('popup.html');

  function bindDrawerControls(drawer, toggleBtn, closeBtn) {
    if (closeBtn) {
      closeBtn.onclick = () => {
        drawer.style.transform = 'translateX(100%)';
        toggleBtn.style.display = 'flex';
      };
    }

    if (toggleBtn) {
      toggleBtn.onclick = () => {
        drawer.style.transform = 'translateX(0)';
        toggleBtn.style.display = 'none';
      };
    }
  }

  function initDrawer() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', initDrawer, { once: true });
      return;
    }

    // 已存在则刷新 iframe 和事件，避免扩展重载后复用失效上下文
    const existing = document.getElementById(DRAWER_ID);
    if (existing) {
      const iframe = existing.querySelector(`#${IFRAME_ID}`);
      const closeBtn = existing.querySelector('#trendspy-drawer-close');
      const btn = document.getElementById(TOGGLE_BTN_ID);
      if (!iframe || !btn) {
        existing.remove();
        btn?.remove();
      } else {
        iframe.src = POPUP_URL;
        bindDrawerControls(existing, btn, closeBtn);
        const isHidden = existing.style.transform === 'translateX(100%)';
        existing.style.transform = isHidden ? 'translateX(0)' : 'translateX(100%)';
        btn.style.display = isHidden ? 'none' : 'flex';
        return;
      }
    }

    // 样式注入
    const style = document.createElement('style');
    style.textContent = `
    #${DRAWER_ID} {
      position: fixed;
      top: 0;
      right: 0;
      width: 460px;
      height: 100vh;
      z-index: 2147483647;
      background: #f6f8fb;
      box-shadow: -4px 0 24px rgba(0,0,0,0.15);
      display: flex;
      flex-direction: column;
      transition: transform 0.25s ease;
      transform: translateX(0);
    }
    #trendspy-drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #1e3a8a;
      color: #fff;
      flex-shrink: 0;
    }
    #trendspy-drawer-header span {
      font-size: 14px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    #trendspy-drawer-close {
      background: none;
      border: none;
      color: #fff;
      font-size: 20px;
      cursor: pointer;
      line-height: 1;
      padding: 2px 6px;
      border-radius: 4px;
      opacity: 0.8;
    }
    #trendspy-drawer-close:hover { opacity: 1; background: rgba(255,255,255,0.15); }
    #${IFRAME_ID} {
      flex: 1;
      border: none;
      width: 100%;
    }
    #${TOGGLE_BTN_ID} {
      position: fixed;
      top: 50%;
      right: 0;
      transform: translateY(-50%);
      z-index: 2147483646;
      background: #1e3a8a;
      color: #fff;
      border: none;
      border-radius: 8px 0 0 8px;
      padding: 10px 6px;
      cursor: pointer;
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      box-shadow: -2px 0 10px rgba(0,0,0,0.2);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    #${TOGGLE_BTN_ID} span {
      writing-mode: vertical-rl;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 1px;
    }
    `;
    (document.head || document.documentElement).appendChild(style);

    // 抽屉容器
    const drawer = document.createElement('div');
    drawer.id = DRAWER_ID;

    const header = document.createElement('div');
    header.id = 'trendspy-drawer-header';
    header.innerHTML = `<span>TrendsSpy 浏览器采集</span><button id="trendspy-drawer-close" title="关闭面板">×</button>`;

    const iframe = document.createElement('iframe');
    iframe.id = IFRAME_ID;
    iframe.src = POPUP_URL;

    drawer.appendChild(header);
    drawer.appendChild(iframe);
    document.body.appendChild(drawer);

    // 重新打开按钮（关闭后显示）
    const toggleBtn = document.createElement('button');
    toggleBtn.id = TOGGLE_BTN_ID;
    toggleBtn.title = '打开 TrendsSpy 面板';
    toggleBtn.innerHTML = '<span>TrendsSpy</span>';
    document.body.appendChild(toggleBtn);

    const closeBtn = header.querySelector('#trendspy-drawer-close');
    bindDrawerControls(drawer, toggleBtn, closeBtn);
  }

  initDrawer();
})();
