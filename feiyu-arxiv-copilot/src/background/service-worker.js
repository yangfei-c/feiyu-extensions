// 飞羽 · 学术论文助手 - Background Service Worker
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'FEIYU_AI_REQUEST') {
    handleAiRequest(msg.payload, sendResponse);
    return true;
  }
  if (msg?.type === 'FEIYU_FETCH_PDF') {
    handleFetchPdf(msg.payload, sendResponse);
    return true;
  }
  return false;
});

// 右键划词菜单（仅限学术论文网站）
const CTX_DOC_PATTERNS = [
  'https://arxiv.org/*',
  'https://ar5iv.labs.arxiv.org/*',
  'https://www.sciencedirect.com/*',
  'https://*.sciencedirectassets.com/*'
];

const CTX_MENUS = [
  { id: 'feiyu-ctx-translate', title: '飞羽：翻译选中内容' },
  { id: 'feiyu-ctx-ask', title: '飞羽：AI 解释/问答选中内容' }
];

function ensureContextMenus() {
  CTX_MENUS.forEach((m) => {
    chrome.contextMenus.create(
      {
        id: m.id,
        title: m.title,
        contexts: ['selection'],
        documentUrlPatterns: CTX_DOC_PATTERNS
      },
      () => {
        // 重复创建时忽略错误（菜单按 id 幂等）
        void chrome.runtime.lastError;
      }
    );
  });
}

chrome.runtime.onInstalled.addListener(ensureContextMenus);
ensureContextMenus();

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const text = (info.selectionText || '').trim();
  if (!text || !tab?.id) return;
  const action = info.menuItemId === 'feiyu-ctx-translate' ? 'translate' : 'ask';
  chrome.tabs.sendMessage(tab.id, {
    type: 'FEIYU_CONTEXT_ACTION',
    action,
    text
  }).catch(() => {});
});

async function handleAiRequest(payload, sendResponse) {
  try {
    const { url, apiKey, model, systemPrompt, userPrompt, imageDataUrl } = payload;
    let targetModel = model || 'deepseek-flash';

    if (imageDataUrl && targetModel === 'deepseek-v4-pro') {
      targetModel = 'deepseek-flash';
    }

    const userContent = imageDataUrl
      ? [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
      : userPrompt;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: targetModel,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      sendResponse({ ok: false, error: `HTTP ${res.status}: ${errText.slice(0, 140)}` });
      return;
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      sendResponse({ ok: false, error: 'AI 返回内容为空' });
      return;
    }
    sendResponse({ ok: true, content });
  } catch (err) {
    sendResponse({ ok: false, error: err?.message || '网络请求失败' });
  }
}

// 代内容脚本下载 PDF 二进制（Service Worker 具备 host_permissions，可跨域抓取），
// 以 base64 返回，规避内容脚本的 CORS 限制。
async function handleFetchPdf(payload, sendResponse) {
  try {
    const { url } = payload || {};
    if (!url) {
      sendResponse({ ok: false, error: '缺少 PDF 地址' });
      return;
    }
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) {
      sendResponse({ ok: false, error: `PDF 下载失败：HTTP ${res.status}` });
      return;
    }
    const buf = await res.arrayBuffer();
    sendResponse({
      ok: true,
      base64: arrayBufferToBase64(buf),
      contentType: res.headers.get('content-type') || ''
    });
  } catch (err) {
    sendResponse({ ok: false, error: err?.message || 'PDF 下载失败' });
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
