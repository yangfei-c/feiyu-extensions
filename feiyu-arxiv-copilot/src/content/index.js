// 飞羽 · arXiv 论文助手 - Content Script：主入口与 AI 调度
(() => {
  'use strict';

  const F = (window.FeiyuArxiv = window.FeiyuArxiv || {});

  if (document.getElementById('feiyu-arxiv-host')) return;

  // 共享运行状态（extractor 与 panel 在调用期读取）
  const isHtmlPaper =
    location.pathname.startsWith('/html/') || location.hostname.includes('ar5iv');
  const isScienceDirect = /(^|\.)sciencedirect\.com$/i.test(location.hostname);
  const isPdfPage =
    location.pathname.startsWith('/pdf/') || location.hostname.includes('sciencedirectassets.com');
  const state = {
    isHtmlPaper,
    isScienceDirect,
    isPdfPage,
    stopBatchFlag: false,
    translationsHidden: false,
    transMode: 'visible',
    guideMode: 'quick',
    pdfPages: [],
    pdfPending: null
  };
  F.state = state;

  function callAI(systemPrompt, userPrompt, imageDataUrl = null) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['provider', 'apiUrl', 'model', 'apiKey'], (cfg) => {
        const apiKey = (cfg.apiKey || '').trim();
        const provider = cfg.provider || 'deepseek';
        const url = (cfg.apiUrl || F.PROVIDERS[provider]?.url || F.PROVIDERS.deepseek.url).trim();
        let model = (cfg.model || F.PROVIDERS[provider]?.models[0] || 'deepseek-flash').trim();

        if (provider === 'deepseek' && (model === 'deepseek-chat' || model === 'deepseek-reasoner')) {
          model = 'deepseek-flash';
        }

        if (!apiKey) {
          reject(new Error('请先点击设置填写 API Key'));
          return;
        }
        if (!url) {
          reject(new Error('请填写有效的接口地址'));
          return;
        }

        chrome.runtime.sendMessage(
          {
            type: 'FEIYU_AI_REQUEST',
            payload: { url, apiKey, model, systemPrompt, userPrompt, imageDataUrl }
          },
          (res) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!res?.ok) {
              reject(new Error(res?.error || '请求失败'));
              return;
            }
            resolve(res.content);
          }
        );
      });
    });
  }

  async function imageToDataUrl(imgEl) {
    if (!imgEl || !imgEl.src) return null;
    try {
      const resp = await fetch(imgEl.src);
      const blob = await resp.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  function saveReadingHistory(record) {
    chrome.storage.local.get(['readingHistory'], (res) => {
      const list = Array.isArray(res.readingHistory) ? res.readingHistory : [];
      const filtered = list.filter((item) => item.arxivId !== record.arxivId);
      filtered.unshift(record);
      // 最多保留最近 200 篇，防止超出本地存储配额
      chrome.storage.local.set({ readingHistory: filtered.slice(0, 200) });
    });
  }

  async function translateParagraph(el) {
    if (!el || el.dataset.feiyuTranslated === '1') return;
    if (el.nextElementSibling?.classList?.contains('feiyu-bilingual-box')) return;

    const isHeading = /^H[1-6]$/.test(el.tagName);
    const { text, tokenMap } = F.render.serializeWithPlaceholders(el);
    if (text.length < (isHeading ? 3 : 20)) return;

    el.dataset.feiyuTranslated = 'loading';

    const box = document.createElement('div');
    box.className = 'feiyu-bilingual-box';
    box.style.cssText = isHeading
      ? `
        margin: 4px 0 12px 0;
        padding: 4px 10px;
        background: #eff6ff;
        border-left: 3px solid #2b67ff;
        border-radius: 0 6px 6px 0;
        color: #1e3a8a;
        font-size: ${el.tagName === 'H1' ? '1.05em' : '0.95em'};
        font-weight: 600;
        line-height: 1.5;
        text-align: ${el.tagName === 'H1' ? 'center' : 'left'};
        display: ${F.state.translationsHidden ? 'none' : 'block'};
      `
      : `
        margin: 6px 0 14px 0;
        padding: 8px 12px;
        background: #f8fafc;
        border-left: 3px solid #2b67ff;
        border-radius: 0 6px 6px 0;
        color: #1e293b;
        font-size: 0.95em;
        line-height: 1.7;
        display: ${F.state.translationsHidden ? 'none' : 'block'};
      `;
    box.innerText = '正在翻译...';
    el.insertAdjacentElement('afterend', box);

    try {
      const sysPrompt = isHeading
        ? '你是学术论文翻译专家。请将英文论文标题或章节小标题翻译为简练准确的简体中文（保留专有名词缩写），仅输出译文。'
        : '你是计算机科学与人工智能顶会学术翻译专家。请将英文论文段落精准翻译为流畅严谨的简体中文。' +
          '约束：1. 保留 Transformer、Attention 等通用英文术语；2. 形如 __FY_0__ 的占位符必须原样保留在对应位置；3. 仅输出译文。' +
          F.PROMPT_REFERENCES;
      const translated = await callAI(sysPrompt, text);
      box.innerHTML = F.render.restorePlaceholdersToHTML(translated, tokenMap);
      el.dataset.feiyuTranslated = '1';
    } catch (err) {
      box.style.borderLeftColor = '#ef4444';
      box.style.color = '#b91c1c';
      box.innerText = `翻译失败: ${err.message}`;
      delete el.dataset.feiyuTranslated;
    }
  }

  async function translateBatch(list, onProgress) {
    for (let i = 0; i < list.length; i++) {
      if (F.state.stopBatchFlag) break;
      onProgress?.(i, list.length);
      await translateParagraph(list[i]);
    }
    return F.state.stopBatchFlag;
  }

  // 下载并缓存 PDF 按页文本（一次解析，导读与页码翻译共用）
  // 用 pdfPending 复用「进行中」的 Promise，防止快速连点「导读」「翻译页码」重复下载解析
  function getPdfPages(url, onProgress) {
    if (F.state.pdfPages && F.state.pdfPages.length) return Promise.resolve(F.state.pdfPages);
    if (F.state.pdfPending) return F.state.pdfPending;
    F.state.pdfPending = (async () => {
      try {
        const buf = await F.pdf.fetchPdfAsArrayBuffer(url, { preferDirect: F.state.isPdfPage });
        const pages = await F.pdf.extractPages(buf, onProgress);
        F.state.pdfPages = pages;
        return pages;
      } finally {
        F.state.pdfPending = null;
      }
    })();
    return F.state.pdfPending;
  }

  function pagesToText(pages) {
    return pages.map((t, i) => `[Page ${i + 1}]\n${t}`).join('\n\n');
  }

  // 全文文本（导读用）
  async function getPdfText(url, onProgress) {
    return pagesToText(await getPdfPages(url, onProgress));
  }

  F.app = {
    callAI,
    imageToDataUrl,
    saveReadingHistory,
    translateParagraph,
    translateBatch,
    getPdfPages,
    getPdfText
  };

  // 主入口：先挂载逐段翻译按钮，再挂载悬浮面板
  F.panel.attachInlineTranslateTriggers();
  F.panel.mountPanel();
})();
