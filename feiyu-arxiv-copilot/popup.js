// 在这里填入你的 Cloudflare Worker 中转地址（例如 https://feiyu-feedback.你的用户名.workers.dev）
const FEEDBACK_ENDPOINT = 'https://feiyu-feedback.tyreelprice91.workers.dev';

const PROVIDERS = {
  deepseek: {
    url: 'https://api.deepseek.com/chat/completions',
    models: ['deepseek-flash', 'deepseek-v4-pro']
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4o-mini', 'gpt-4o', 'o3-mini']
  },
  custom: {
    url: '',
    models: ['deepseek-flash', 'deepseek-v4-pro', 'gpt-4o-mini', 'gpt-4o']
  }
};

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

chrome.storage.local.get(['showPanel', 'provider', 'apiUrl', 'model', 'apiKey', 'readingHistory'], (cfg) => {
  showPanelCheck.checked = cfg.showPanel !== false;
  const p = cfg.provider || 'deepseek';
  provSel.value = p;
  fillModels(p, cfg.model);
  urlInp.value = cfg.apiUrl || PROVIDERS[p]?.url || '';
  keyInp.value = cfg.apiKey || '';
  const hist = Array.isArray(cfg.readingHistory) ? cfg.readingHistory : [];
  countEl.innerText = hist.length;
});

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

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 导出全部已读论文为 Markdown 笔记合集
document.getElementById('h-export-md').onclick = () => {
  chrome.storage.local.get(['readingHistory'], (res) => {
    const hist = Array.isArray(res.readingHistory) ? res.readingHistory : [];
    if (hist.length === 0) {
      msgEl.innerText = '暂无已读记录，请先在论文页生成导读';
      return;
    }
    const md = hist
      .map((item) => {
        const timeStr = new Date(item.readAt).toLocaleString();
        return `# ${item.title}\n\n- arXiv: ${item.url}\n- 阅读时间: ${timeStr}\n${item.codeRepo ? `- 开源代码: ${item.codeRepo}\n` : ''}\n${item.summary || ''}\n\n---\n`;
      })
      .join('\n');
    downloadFile('feiyu-arxiv-notes.md', md, 'text/markdown;charset=utf-8');
    msgEl.innerText = `已导出 ${hist.length} 篇 Markdown 笔记`;
  });
};

// 导出为 BibTeX 格式，可直接拖入 Zotero 导入文献库
document.getElementById('h-export-bib').onclick = () => {
  chrome.storage.local.get(['readingHistory'], (res) => {
    const hist = Array.isArray(res.readingHistory) ? res.readingHistory : [];
    if (hist.length === 0) {
      msgEl.innerText = '暂无已读记录';
      return;
    }
    const bib = hist
      .map((item, idx) => {
        const id = (item.arxivId || `arxiv_${idx + 1}`).replace(/[^a-zA-Z0-9_]/g, '_');
        const year = (item.arxivId || '').match(/^(\d{2})/) ? '20' + item.arxivId.slice(0, 2) : '2026';
        return `@article{${id},\n  title={${item.title}},\n  author={${item.authors || 'arXiv Authors'}},\n  year={${year}},\n  eprint={${item.arxivId || ''}},\n  archivePrefix={arXiv},\n  url={${item.url}}\n}`;
      })
      .join('\n\n');
    downloadFile('feiyu-arxiv-papers.bib', bib, 'text/plain;charset=utf-8');
    msgEl.innerText = `已导出 ${hist.length} 篇 BibTeX，可导入 Zotero`;
  });
};

document.getElementById('h-clear').onclick = () => {
  chrome.storage.local.set({ readingHistory: [] }, () => {
    countEl.innerText = '0';
    msgEl.innerText = '已清空阅读记录';
  });
};

const fbBox = document.getElementById('fb-box');
const fbText = document.getElementById('fb-text');
const fbContact = document.getElementById('fb-contact');
const fbSend = document.getElementById('fb-send');
const fbMsg = document.getElementById('fb-msg');

document.getElementById('p-feedback-toggle').onclick = () => {
  fbBox.style.display = fbBox.style.display === 'none' ? 'block' : 'none';
};

fbSend.onclick = async () => {
  const content = fbText.value.trim();
  if (!content) {
    fbMsg.innerText = '请先填写反馈内容';
    return;
  }
  if (!FEEDBACK_ENDPOINT) {
    fbMsg.innerText = '尚未配置中转地址（请在 popup.js 第 2 行填入 Worker URL）';
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
