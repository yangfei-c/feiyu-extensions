// 飞羽 · B站学习助手 - Background Service Worker
// 职责：代理 AI 请求；代理 B 站接口请求（携带登录态 Cookie，规避内容脚本的跨域限制）。
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'FEIYU_AI_REQUEST') {
    handleAiRequest(msg.payload, sendResponse);
    return true;
  }
  if (msg?.type === 'FEIYU_BILI_FETCH') {
    handleBiliFetch(msg.payload, sendResponse);
    return true;
  }
  return false;
});

async function handleAiRequest(payload, sendResponse) {
  try {
    const { url, apiKey, model, systemPrompt, userPrompt } = payload || {};

    if (!url) {
      sendResponse({ ok: false, error: '请先填写有效的接口地址' });
      return;
    }
    if (!apiKey) {
      sendResponse({ ok: false, error: '请先填写 API Key' });
      return;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || 'deepseek-flash',
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
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

// 允许代理的 B 站域名白名单（防止被任意地址利用）
const BILI_HOST_ALLOWLIST = ['api.bilibili.com', 'aisubtitle.hdslb.com'];

// 代理 B 站 / 字幕 JSON 请求。
// credentials: 'include' 用于复用用户在 bilibili.com 的登录 Cookie（字幕、评论依赖登录态）。
async function handleBiliFetch(payload, sendResponse) {
  try {
    const { url, responseType = 'json' } = payload || {};
    if (!url) {
      sendResponse({ ok: false, error: '缺少请求地址' });
      return;
    }

    let target;
    try {
      target = new URL(url);
    } catch {
      sendResponse({ ok: false, error: '请求地址无效' });
      return;
    }
    if (target.protocol !== 'https:' || !BILI_HOST_ALLOWLIST.includes(target.hostname)) {
      sendResponse({ ok: false, error: '该地址不在允许的请求白名单内' });
      return;
    }

    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': responseType === 'text' ? '*/*' : 'application/json' }
    });

    if (responseType === 'text') {
      const text = await res.text();
      sendResponse({ ok: res.ok, status: res.status, text });
      return;
    }

    const data = await res.json().catch(() => null);
    if (!data) {
      sendResponse({ ok: false, status: res.status, error: `接口返回非 JSON（HTTP ${res.status}）` });
      return;
    }
    sendResponse({ ok: true, status: res.status, data });
  } catch (err) {
    sendResponse({ ok: false, error: err?.message || '请求失败' });
  }
}
