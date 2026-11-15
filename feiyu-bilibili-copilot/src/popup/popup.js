// 飞羽 · B站学习助手 - Popup：配置、笔记导出与反馈
(() => {
  'use strict';

  const F = window.FeiyuBili;
  const { PROVIDERS, FEEDBACK_ENDPOINT, STORAGE_KEYS } = F;

  const showPanelCheck = document.getElementById('p-show-panel');
  const provSel = document.getElementById('p-provider');
  const modelSel = document.getElementById('p-model');
  const customWrap = document.getElementById('p-custom');
  const urlInp = document.getElementById('p-url');
  const keyInp = document.getElementById('p-key');
  const msgEl = document.getElementById('p-msg');
  const countEl = document.getElementById('h-count');

  function fillModels(prov, selected) {
    const cfg = PROVIDERS[prov] || PROVIDERS.deepseek;
    modelSel.innerHTML = '';
    cfg.models.forEach((m) => {
      const o = document.createElement('option');
      o.value = m;
      o.innerText = m;
      modelSel.appendChild(o);
    });
    if (selected && cfg.models.includes(selected)) modelSel.value = selected;
    customWrap.style.display = prov === 'custom' ? 'block' : 'none';
    if (prov !== 'custom') urlInp.value = cfg.url;
  }

  provSel.onchange = () => fillModels(provSel.value);

  chrome.storage.local.get(
    ['showPanel', 'provider', 'apiUrl', 'model', 'apiKey', STORAGE_KEYS.notes],
    (cfg) => {
      showPanelCheck.checked = cfg.showPanel !== false;
      const p = cfg.provider || 'deepseek';
      provSel.value = p;
      fillModels(p, cfg.model);
      urlInp.value = cfg.apiUrl || PROVIDERS[p]?.url || '';
      keyInp.value = cfg.apiKey || '';
      const notes = Array.isArray(cfg[STORAGE_KEYS.notes]) ? cfg[STORAGE_KEYS.notes] : [];
      countEl.innerText = notes.length;
    }
  );

  showPanelCheck.onchange = () => {
    const visible = showPanelCheck.checked;
    chrome.storage.local.set({ showPanel: visible }, () => {
      msgEl.innerText = visible ? '已显示悬浮面板' : '已隐藏悬浮面板';
    });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'FEIYU_TOGGLE_PANEL', visible }, () => {
          if (chrome.runtime.lastError) {
            msgEl.innerText = '已保存（若页面在更新前已打开，请刷新一次）';
          }
        });
      }
    });
  };

  document.getElementById('p-save').onclick = async () => {
    const p = provSel.value;
    const finalUrl = p === 'custom' ? urlInp.value.trim() : PROVIDERS[p].url;

    if (p === 'custom' && finalUrl) {
      try {
        const origin = new URL(finalUrl).origin + '/*';
        await chrome.permissions.request({ origins: [origin] });
      } catch {}
    }

    chrome.storage.local.set(
      { provider: p, apiUrl: finalUrl, model: modelSel.value, apiKey: keyInp.value.trim() },
      () => { msgEl.innerText = '已保存'; }
    );
  };

  // 导出全部视频笔记为 Markdown
  document.getElementById('h-export-md').onclick = () => {
    chrome.storage.local.get([STORAGE_KEYS.notes], (res) => {
      const notes = Array.isArray(res[STORAGE_KEYS.notes]) ? res[STORAGE_KEYS.notes] : [];
      const result = F.export.exportMarkdown(notes);
      if (!result.ok) {
        msgEl.innerText = result.message;
        return;
      }
      F.export.downloadFile(result.filename, result.content, result.mimeType);
      msgEl.innerText = result.message;
    });
  };

  document.getElementById('h-clear').onclick = (e) => {
    e.preventDefault();
    chrome.storage.local.set({ [STORAGE_KEYS.notes]: [] }, () => {
      countEl.innerText = '0';
      msgEl.innerText = '已清空笔记记录';
    });
  };

  const fbBox = document.getElementById('fb-box');
  const fbText = document.getElementById('fb-text');
  const fbContact = document.getElementById('fb-contact');
  const fbSend = document.getElementById('fb-send');
  const fbMsg = document.getElementById('fb-msg');

  document.getElementById('p-feedback-toggle').onclick = (e) => {
    e.preventDefault();
    fbBox.style.display = fbBox.style.display === 'none' ? 'block' : 'none';
  };

  fbSend.onclick = async () => {
    const content = fbText.value.trim();
    if (!content) {
      fbMsg.innerText = '请先填写反馈内容';
      return;
    }
    if (!FEEDBACK_ENDPOINT) {
      fbMsg.innerText = '尚未配置中转地址（请在 src/config/constants.js 中填入 Worker URL）';
      return;
    }

    fbSend.disabled = true;
    fbMsg.innerText = '正在发送...';

    let pageUrl = '';
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      pageUrl = tabs[0]?.url || '';
    } catch {}

    try {
      const res = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          contact: fbContact.value.trim(),
          pageUrl,
          version: chrome.runtime.getManifest().version
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        fbText.value = '';
        fbContact.value = '';
        fbMsg.innerText = '反馈已发送，感谢你的建议';
      } else {
        fbMsg.innerText = data.error || '发送失败，请稍后重试';
      }
    } catch {
      fbMsg.innerText = '网络请求失败，请检查中转地址';
    } finally {
      fbSend.disabled = false;
    }
  };
})();
