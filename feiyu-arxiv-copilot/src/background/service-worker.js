// 飞羽 · arXiv 论文助手 - Background Service Worker
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'FEIYU_AI_REQUEST') return false;

  (async () => {
    try {
      const { url, apiKey, model, systemPrompt, userPrompt, imageDataUrl } = msg.payload;
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
  })();

  return true;
});
