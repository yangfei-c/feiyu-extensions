// 飞羽 · arXiv 论文助手 - Content Script (v2.2)
(() => {
  'use strict';

  if (location.pathname.startsWith('/pdf/')) {
    if (document.getElementById('feiyu-pdf-bar')) return;
    const arxivId = location.pathname.replace(/^\/pdf\//, '').replace(/\.pdf$/i, '');
    const htmlUrl = `https://arxiv.org/html/${arxivId}`;
    const bar = document.createElement('a');
    bar.id = 'feiyu-pdf-bar';
    bar.href = htmlUrl;
    bar.innerText = '飞羽：切换到 HTML 全文版使用 AI 导读与翻译';
    bar.style.cssText = `
      position: fixed; top: 14px; right: 20px; z-index: 2147483647;
      background: #2b67ff; color: #fff;
      padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;
      text-decoration: none; box-shadow: 0 4px 12px rgba(43,103,255,0.3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    `;
    document.body.appendChild(bar);
    return;
  }

  if (document.getElementById('feiyu-arxiv-host')) return;

  const isHtmlPaper =
    location.pathname.startsWith('/html/') || location.hostname.includes('ar5iv');
  let stopBatchFlag = false;
  let translationsHidden = false;

  // 在这里填入你的 Cloudflare Worker 中转地址（例如 https://feiyu-feedback.你的用户名.workers.dev）
const FEEDBACK_ENDPOINT = 'https://feiyu-feedback.tyreelprice91.workers.dev';

const PROVIDERS = {
    deepseek: {
      label: 'DeepSeek',
      url: 'https://api.deepseek.com/chat/completions',
      models: ['deepseek-flash', 'deepseek-v4-pro']
    },
    openai: {
      label: 'OpenAI',
      url: 'https://api.openai.com/v1/chat/completions',
      models: ['gpt-4o-mini', 'gpt-4o', 'o3-mini']
    },
    custom: {
      label: '自定义接口',
      url: '',
      models: ['deepseek-flash', 'deepseek-v4-pro', 'gpt-4o-mini', 'gpt-4o']
    }
  };

  function callAI(systemPrompt, userPrompt, imageDataUrl = null) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['provider', 'apiUrl', 'model', 'apiKey'], (cfg) => {
        const apiKey = (cfg.apiKey || '').trim();
        const provider = cfg.provider || 'deepseek';
        const url = (cfg.apiUrl || PROVIDERS[provider]?.url || PROVIDERS.deepseek.url).trim();
        let model = (cfg.model || PROVIDERS[provider]?.models[0] || 'deepseek-flash').trim();

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

  function latexToHtml(tex) {
    let s = (tex || '').trim();
    const symbols = {
      '\\\\mathbb\\{R\\}': 'ℝ',
      '\\\\mathbb\\{N\\}': 'ℕ',
      '\\\\mathbb\\{Z\\}': 'ℤ',
      '\\\\mathbb\\{E\\}': '𝔼',
      '\\\\mathcal\\{L\\}': 'ℒ',
      '\\\\mathcal\\{D\\}': '𝒟',
      '\\\\cdot': '·',
      '\\\\cdots': '⋯',
      '\\\\times': '×',
      '\\\\in': '∈',
      '\\\\notin': '∉',
      '\\\\leq': '≤',
      '\\\\geq': '≥',
      '\\\\neq': '≠',
      '\\\\approx': '≈',
      '\\\\rightarrow': '→',
      '\\\\to': '→',
      '\\\\leftarrow': '←',
      '\\\\sum': '∑',
      '\\\\prod': '∏',
      '\\\\infty': '∞',
      '\\\\alpha': 'α',
      '\\\\beta': 'β',
      '\\\\gamma': 'γ',
      '\\\\delta': 'δ',
      '\\\\theta': 'θ',
      '\\\\lambda': 'λ',
      '\\\\sigma': 'σ',
      '\\\\tau': 'τ',
      '\\\\phi': 'φ',
      '\\\\psi': 'ψ',
      '\\\\omega': 'ω',
      '\\\\log': 'log',
      '\\\\exp': 'exp',
      '\\\\top': 'ᵀ'
    };
    for (const [pat, rep] of Object.entries(symbols)) {
      s = s.replace(new RegExp(pat, 'g'), rep);
    }

    s = s
      .replace(/\\text\{([^}]*)\}/g, '$1')
      .replace(/\\mathrm\{([^}]*)\}/g, '$1')
      .replace(/\\mathbf\{([^}]*)\}/g, '<b>$1</b>')
      .replace(/\\hat\s*\{?([A-Za-z0-9]+)\}?/g, '$1\u0302')
      .replace(/\\bar\s*\{?([A-Za-z0-9]+)\}?/g, '$1\u0304')
      .replace(/\\tilde\s*\{?([A-Za-z0-9]+)\}?/g, '$1\u0303')
      .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
      .replace(/\\sqrt\{([^}]*)\}/g, '√($1)')
      .replace(/_\{([^}]*)\}/g, '<sub>$1</sub>')
      .replace(/\^\{([^}]*)\}/g, '<sup>$1</sup>')
      .replace(/_([A-Za-z0-9])/g, '<sub>$1</sub>')
      .replace(/\^([A-Za-z0-9])/g, '<sup>$1</sup>')
      .replace(/\\[a-zA-Z]+/g, '')
      .replace(/[{}]/g, '');

    return s.trim();
  }

  function renderMarkdownToHTML(mdText) {
    const mathTokens = new Map();
    let mIdx = 0;

    const preprocessed = (mdText || '')
      .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => {
        const key = `__MBLK_${mIdx++}__`;
        mathTokens.set(key, `<div class="math-block">${latexToHtml(tex)}</div>`);
        return `\n${key}\n`;
      })
      .replace(/\\\[([\s\S]+?)\\\]/g, (_m, tex) => {
        const key = `__MBLK_${mIdx++}__`;
        mathTokens.set(key, `<div class="math-block">${latexToHtml(tex)}</div>`);
        return `\n${key}\n`;
      })
      .replace(/\\\((.+?)\\\)/g, (_m, tex) => {
        const key = `__MINL_${mIdx++}__`;
        mathTokens.set(key, `<span class="math-inline">${latexToHtml(tex)}</span>`);
        return key;
      })
      .replace(/\$([^$\n]+?)\$/g, (_m, tex) => {
        const key = `__MINL_${mIdx++}__`;
        mathTokens.set(key, `<span class="math-inline">${latexToHtml(tex)}</span>`);
        return key;
      });

    const escaped = preprocessed
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const restoreMath = (str) => {
      let out = str;
      for (const [k, v] of mathTokens.entries()) {
        out = out.split(k).join(v);
      }
      return out;
    };

    const formatInline = (str) =>
      restoreMath(
        str
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/`([^`]+)`/g, '<code>$1</code>')
          .replace(
            /(https?:\/\/[^\s)<>]+)/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
          )
      );

    const lines = escaped.split('\n');
    const htmlParts = [];
    let inList = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        if (inList) {
          htmlParts.push('</ul>');
          inList = false;
        }
        continue;
      }

      if (/^__MBLK_\d+__$/.test(line)) {
        if (inList) {
          htmlParts.push('</ul>');
          inList = false;
        }
        htmlParts.push(restoreMath(line));
      } else if (/^#{1,3}\s+/.test(line)) {
        if (inList) {
          htmlParts.push('</ul>');
          inList = false;
        }
        const level = line.match(/^(#{1,3})/)[1].length;
        const text = formatInline(line.replace(/^#{1,3}\s+/, ''));
        htmlParts.push(`<div class="md-h${level}">${text}</div>`);
      } else if (/^[-*•]\s+/.test(line)) {
        if (!inList) {
          htmlParts.push('<ul>');
          inList = true;
        }
        const text = formatInline(line.replace(/^[-*•]\s+/, ''));
        htmlParts.push(`<li>${text}</li>`);
      } else if (/^\d+\.\s+/.test(line)) {
        if (inList) {
          htmlParts.push('</ul>');
          inList = false;
        }
        htmlParts.push(`<div class="md-num">${formatInline(line)}</div>`);
      } else {
        if (inList) {
          htmlParts.push('</ul>');
          inList = false;
        }
        htmlParts.push(`<p>${formatInline(line)}</p>`);
      }
    }

    if (inList) htmlParts.push('</ul>');
    return htmlParts.join('');
  }

  function serializeWithPlaceholders(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.feiyu-inline-btn, .feiyu-fig-btn').forEach((b) => b.remove());

    const tokenMap = new Map();
    let idx = 0;

    const protectedSelectors =
      'math, mjx-container, .ltx_Math, .ltx_equation, .ltx_cite, .ltx_ref, code';
    clone.querySelectorAll(protectedSelectors).forEach((node) => {
      if (!node.parentNode) return;
      const token = `__FY_${idx++}__`;
      tokenMap.set(token, node.outerHTML);
      node.replaceWith(document.createTextNode(` ${token} `));
    });

    const text = (clone.innerText || clone.textContent || '')
      .replace(/^Title:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    return { text, tokenMap };
  }

  function extractSelectionPayload(range) {
    const frag = range.cloneContents();
    const wrap = document.createElement('div');
    wrap.appendChild(frag);

    wrap.querySelectorAll('math, .ltx_Math').forEach((m) => {
      const tex = m.getAttribute('alttext') || m.textContent || '';
      if (tex.trim()) {
        m.replaceWith(document.createTextNode(` $${tex.trim()}$ `));
      }
    });

    const imgInFrag = wrap.querySelector('img');
    let imgEl = null;
    if (imgInFrag) {
      imgEl = Array.from(document.querySelectorAll('img')).find((i) => i.src === imgInFrag.src) || imgInFrag;
    }

    const text = (wrap.innerText || wrap.textContent || '').replace(/\s+/g, ' ').trim();
    return { text, imgEl };
  }

  function restorePlaceholdersToHTML(translatedText, tokenMap) {
    let html = translatedText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    for (const [token, origHtml] of tokenMap.entries()) {
      html = html.split(token).join(origHtml);
    }
    return html;
  }

  function detectCodeRepos() {
    const repos = new Set();
    const repoRegex =
      /https?:\/\/(?:github\.com|gitlab\.com|huggingface\.co|gitee\.com)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/gi;

    const isBlacklisted = (url) => {
      const low = url.toLowerCase();
      return (
        low.includes('github.com/arxiv/') ||
        low.includes('github.com/brucemiller/') ||
        low.includes('github.com/latexml')
      );
    };

    const contentRoots = document.querySelectorAll(
      '.ltx_abstract, blockquote.abstract, .ltx_document, article, #abs'
    );
    const roots = contentRoots.length > 0 ? Array.from(contentRoots) : [document.body];

    for (const root of roots) {
      root.querySelectorAll('a[href]').forEach((a) => {
        if (a.closest('.ltx_bibliography, header, nav, .ltx_page_header, #feiyu-arxiv-host')) return;
        const matches = (a.href || '').match(repoRegex);
        if (matches) {
          matches.forEach((u) => {
            const clean = u.replace(/[.,;)\]]+$/, '');
            if (!isBlacklisted(clean)) repos.add(clean);
          });
        }
      });
    }

    const scopeText =
      (document.querySelector('blockquote.abstract, .ltx_abstract')?.innerText || '') +
      '\n' +
      Array.from(document.querySelectorAll('p.ltx_p'))
        .slice(0, 15)
        .map((p) => p.innerText || '')
        .join('\n');

    const textMatches = scopeText.match(repoRegex);
    if (textMatches) {
      textMatches.forEach((u) => {
        const clean = u.replace(/[.,;)\]]+$/, '');
        if (!isBlacklisted(clean)) repos.add(clean);
      });
    }

    return Array.from(repos);
  }

  function getCleanText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.feiyu-inline-btn, .feiyu-fig-btn, .feiyu-bilingual-box').forEach((n) => n.remove());
    return (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function extractPaperInfo() {
    const arxivIdMatch = location.pathname.match(/\/(?:abs|html|pdf)\/([^/?#]+)/);
    const arxivId = arxivIdMatch ? arxivIdMatch[1].replace(/v\d+$/, '') : location.pathname;

    const titleEl =
      document.querySelector('h1.ltx_title_document, h1.title') ||
      document.querySelector('h1');
    const title =
      getCleanText(titleEl || document.body)
        .replace(/^Title:\s*/i, '')
        .trim() || document.title;

    const authorsEl = document.querySelector('.ltx_authors, .authors');
    const pureAuthors = getCleanText(authorsEl).replace(/^Authors:\s*/i, '').trim();
    const authorNotes = Array.from(
      document.querySelectorAll('.ltx_author_notes, .ltx_authors .ltx_note, .ltx_contact')
    )
      .map((el) => getCleanText(el))
      .filter(Boolean)
      .join(' | ');
    const authorsText = [pureAuthors, authorNotes].filter(Boolean).join(' | ');

    const absEl =
      document.querySelector('blockquote.abstract') ||
      document.querySelector('.ltx_abstract');
    const abstractText = getCleanText(absEl).replace(/^Abstract[:\s]*/i, '').trim();

    const codeRepos = detectCodeRepos();

    let fullBodyText = '';
    if (isHtmlPaper) {
      const nodes = Array.from(
        document.querySelectorAll(
          'h2.ltx_title_section, h3.ltx_title_subsection, p.ltx_p, figcaption.ltx_caption'
        )
      ).filter((el) => !el.closest('.ltx_bibliography, .ltx_authors, #feiyu-arxiv-host'));

      const chunks = [];
      for (const el of nodes) {
        const t = getCleanText(el);
        if (!t) continue;
        if (el.tagName === 'H2') chunks.push(`\n## ${t}`);
        else if (el.tagName === 'H3') chunks.push(`\n### ${t}`);
        else if (t.length >= 25) chunks.push(t);
      }
      fullBodyText = chunks.join('\n\n').slice(0, 36000);
    }

    return { arxivId, title, pureAuthors, authorsText, abstractText, fullBodyText, codeRepos };
  }

  async function translateParagraph(el) {
    if (!el || el.dataset.feiyuTranslated === '1') return;
    if (el.nextElementSibling?.classList?.contains('feiyu-bilingual-box')) return;

    const isHeading = /^H[1-6]$/.test(el.tagName);
    const { text, tokenMap } = serializeWithPlaceholders(el);
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
        display: ${translationsHidden ? 'none' : 'block'};
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
        display: ${translationsHidden ? 'none' : 'block'};
      `;
    box.innerText = '正在翻译...';
    el.insertAdjacentElement('afterend', box);

    try {
      const sysPrompt = isHeading
        ? '你是学术论文翻译专家。请将英文论文标题或章节小标题翻译为简练准确的简体中文（保留专有名词缩写），仅输出译文。'
        : '你是计算机科学与人工智能顶会学术翻译专家。请将英文论文段落精准翻译为流畅严谨的简体中文。' +
          '约束：1. 保留 Transformer、Attention 等通用英文术语；2. 形如 __FY_0__ 的占位符必须原样保留在对应位置；3. 仅输出译文。';
      const translated = await callAI(sysPrompt, text);
      box.innerHTML = restorePlaceholdersToHTML(translated, tokenMap);
      el.dataset.feiyuTranslated = '1';
    } catch (err) {
      box.style.borderLeftColor = '#ef4444';
      box.style.color = '#b91c1c';
      box.innerText = `翻译失败: ${err.message}`;
      delete el.dataset.feiyuTranslated;
    }
  }

  function getTranslatableParagraphs() {
    if (!isHtmlPaper) {
      const list = [];
      const titleEl = document.querySelector('h1.title');
      if (titleEl) list.push(titleEl);
      const abs = document.querySelector('blockquote.abstract');
      if (abs) list.push(abs);
      return list;
    }
    return Array.from(
      document.querySelectorAll(
        'h1.ltx_title_document, h1.title, h2.ltx_title_section, h3.ltx_title_subsection, .ltx_abstract p, p.ltx_p'
      )
    ).filter((el) => {
      if (el.closest('.ltx_bibliography, .ltx_authors')) return false;
      const isHeading = /^H[1-6]$/.test(el.tagName);
      return (el.innerText || '').trim().length >= (isHeading ? 3 : 25);
    });
  }

  function mountPanel() {
    const host = document.createElement('div');
    host.id = 'feiyu-arxiv-host';
    host.style.cssText = 'position:fixed;top:64px;right:20px;z-index:2147483647;';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        .card {
          width: 360px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
          color: #1e293b;
          font-size: 13px;
          overflow: hidden;
          transition: width 0.2s ease;
        }
        .card.wide { width: 520px; }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 9px 12px;
          background: #2b67ff;
          color: #fff;
          cursor: move;
          user-select: none;
        }
        .title { font-weight: 600; font-size: 13px; }
        .actions span { cursor: pointer; margin-left: 10px; font-size: 13px; opacity: 0.9; }
        .actions span:hover { opacity: 1; }
        .body { padding: 12px; }
        .cfg-box {
          display: none;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 10px;
          margin-bottom: 10px;
          font-size: 12px;
        }
        .cfg-box label { display: block; color: #475569; margin-bottom: 3px; font-size: 11px; font-weight: 600; }
        .cfg-box select, .cfg-box input {
          width: 100%;
          padding: 6px 8px;
          border: 1px solid #cbd5e1;
          border-radius: 5px;
          margin-bottom: 8px;
          font-size: 12px;
          background: #fff;
          color: #1e293b;
        }
        .btn-row { display: flex; gap: 6px; margin-bottom: 8px; }
        button {
          border: none;
          border-radius: 6px;
          padding: 7px 8px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        button:hover { opacity: 0.92; }
        .btn-primary { flex: 1; background: #2b67ff; color: #fff; }
        .btn-green { flex: 1; background: #0f766e; color: #fff; }
        .btn-ghost { background: #f1f5f9; color: #334155; padding: 7px 10px; }
        .btn-outline { width: 100%; background: #f1f5f9; color: #334155; margin-top: 8px; }
        .status { font-size: 11px; color: #0f766e; min-height: 16px; margin-bottom: 8px; }
        .status.err { color: #dc2626; }

        .qa-box {
          display: none;
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 8px;
          padding: 10px;
          margin-bottom: 10px;
        }
        .qa-context {
          font-size: 11px;
          color: #78350f;
          background: #fef3c7;
          padding: 5px 8px;
          border-radius: 5px;
          margin-bottom: 6px;
          max-height: 60px;
          overflow-y: auto;
          word-break: break-word;
        }
        .qa-img-preview { max-width: 100%; max-height: 90px; border-radius: 4px; margin-bottom: 6px; display: none; }
        .qa-input-row { display: flex; gap: 6px; margin-bottom: 6px; }
        .qa-input-row input {
          flex: 1; padding: 6px 8px; border: 1px solid #fcd34d; border-radius: 5px; font-size: 12px;
        }
        .qa-answer {
          font-size: 12.5px; line-height: 1.65; color: #1e293b; max-height: 240px; overflow-y: auto;
        }

        .summary-box {
          display: none;
          max-height: 380px;
          overflow-y: auto;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 12px;
          font-size: 12.5px;
          line-height: 1.68;
          color: #334155;
        }
        .code-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 7px 10px;
          margin-bottom: 10px;
          border-radius: 6px;
          font-size: 12px;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          color: #065f46;
        }
        .code-banner.none {
          background: #f1f5f9;
          border-color: #cbd5e1;
          color: #475569;
        }
        .code-banner a {
          color: #2b67ff;
          text-decoration: none;
          font-weight: 600;
          max-width: 210px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .code-banner a:hover { text-decoration: underline; }
        .md-h1 { font-size: 14px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0; }
        .md-h2 {
          font-size: 13px; font-weight: 700; color: #1e40af;
          margin: 12px 0 5px 0; padding-left: 7px; border-left: 3px solid #2b67ff;
        }
        .md-h3 { font-size: 12.5px; font-weight: 700; color: #1e293b; margin: 8px 0 3px 0; }
        p { margin: 4px 0; }
        ul { margin: 4px 0 8px 0; padding-left: 16px; }
        li { margin-bottom: 4px; }
        strong { color: #0f172a; }
        code { background: #e2e8f0; padding: 1px 4px; border-radius: 3px; font-size: 11px; }
        a { color: #2b67ff; text-decoration: none; word-break: break-all; }
        a:hover { text-decoration: underline; }
        .md-num { margin: 5px 0; font-weight: 600; color: #1e293b; }
        .math-inline {
          font-family: "Cambria Math", "Times New Roman", Georgia, serif;
          font-style: italic;
          background: #eef2ff;
          color: #1e1b4b;
          padding: 0 3px;
          border-radius: 3px;
        }
        .math-block {
          font-family: "Cambria Math", "Times New Roman", Georgia, serif;
          background: #eef2ff;
          color: #1e1b4b;
          padding: 6px 10px;
          margin: 6px 0;
          border-radius: 6px;
          text-align: center;
          overflow-x: auto;
        }
        .footer-note {
          margin-top: 8px;
          font-size: 10.5px;
          color: #94a3b8;
          text-align: center;
        }
      </style>
      <div class="card" id="main-card">
        <div class="header" id="drag-header">
          <div class="title">飞羽 · arXiv 论文助手</div>
          <div class="actions">
            <span id="btn-wide" title="宽屏/窄屏">⤢</span>
            <span id="btn-cfg" title="模型设置">⚙</span>
            <span id="btn-min" title="折叠">—</span>
            <span id="btn-hide" title="隐藏面板（可在右上角扩展图标重新开启）">✕</span>
          </div>
        </div>
        <div class="body" id="panel-body">
          <div class="cfg-box" id="cfg-box">
            <label>服务商</label>
            <select id="sel-provider">
              <option value="deepseek">DeepSeek</option>
              <option value="openai">OpenAI</option>
              <option value="custom">自定义接口</option>
            </select>

            <label>模型</label>
            <select id="sel-model"></select>

            <div id="custom-url-wrap" style="display:none;">
              <label>接口地址</label>
              <input id="inp-url" type="text" placeholder="https://xxx/v1/chat/completions" />
              <label>自定义模型名（留空则用上方所选）</label>
              <input id="inp-custom-model" type="text" placeholder="例如 deepseek-v4-pro" />
            </div>

            <label>API Key</label>
            <input id="inp-key" type="password" placeholder="sk-..." />
            <button class="btn-primary" id="btn-save-cfg" style="width:100%;">保存配置</button>
          </div>

          <div class="btn-row">
            <button class="btn-primary" id="btn-summary">结构化导读</button>
            <button class="btn-green" id="btn-translate">${isHtmlPaper ? '全文翻译' : '翻译摘要'}</button>
            <button class="btn-ghost" id="btn-toggle-trans" title="隐藏/显示译文">显隐</button>
          </div>

          <div class="status" id="status">就绪 · 可划选段落、公式或点击图片提问</div>

          <div class="qa-box" id="qa-box">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <strong style="font-size:12px;color:#92400e;">选区问答</strong>
              <span id="qa-close" style="cursor:pointer;font-size:12px;color:#92400e;">✕</span>
            </div>
            <img id="qa-img" class="qa-img-preview" />
            <div class="qa-context" id="qa-context"></div>
            <div class="qa-input-row">
              <input id="qa-input" type="text" placeholder="输入问题（如：举例解释、推导公式）" />
              <button class="btn-primary" id="qa-send" style="flex:none;padding:6px 10px;">提问</button>
            </div>
            <div class="qa-answer" id="qa-answer"></div>
          </div>

          <div class="summary-box" id="summary-box"></div>
          <button class="btn-outline" id="btn-copy-md" style="display:none;">复制 Markdown 笔记</button>

          <div class="footer-note">仅用于 arXiv 论文页面 · 需自行配置模型 API Key</div>
        </div>
      </div>
    `;

    const $ = (sel) => shadow.querySelector(sel);
    const cardEl = $('#main-card');
    const providerSel = $('#sel-provider');
    const modelSel = $('#sel-model');
    const customWrap = $('#custom-url-wrap');
    const urlInp = $('#inp-url');
    const customModelInp = $('#inp-custom-model');
    const keyInp = $('#inp-key');
    const statusEl = $('#status');
    const summaryBox = $('#summary-box');
    const copyMdBtn = $('#btn-copy-md');
    const cfgBox = $('#cfg-box');
    const panelBody = $('#panel-body');

    const qaBox = $('#qa-box');
    const qaImg = $('#qa-img');
    const qaContext = $('#qa-context');
    const qaInput = $('#qa-input');
    const qaAnswer = $('#qa-answer');

    let currentQaText = '';
    let currentQaImageEl = null;

    const setStatus = (msg, isErr = false) => {
      statusEl.className = isErr ? 'status err' : 'status';
      statusEl.innerText = msg;
    };

    function populateModels(providerKey, selectedModelId) {
      const p = PROVIDERS[providerKey] || PROVIDERS.deepseek;
      modelSel.innerHTML = '';
      p.models.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.innerText = m;
        modelSel.appendChild(opt);
      });
      if (selectedModelId && p.models.includes(selectedModelId)) {
        modelSel.value = selectedModelId;
      }
      customWrap.style.display = providerKey === 'custom' ? 'block' : 'none';
      if (providerKey !== 'custom') urlInp.value = p.url;
    }

    providerSel.onchange = () => populateModels(providerSel.value);

    chrome.storage.local.get(['showPanel', 'provider', 'apiUrl', 'model', 'apiKey'], (cfg) => {
      if (cfg.showPanel === false) {
        host.style.display = 'none';
      }
      const prov = cfg.provider || 'deepseek';
      providerSel.value = prov;
      populateModels(prov, cfg.model);
      urlInp.value = cfg.apiUrl || PROVIDERS[prov]?.url || '';
      if (prov === 'custom' && cfg.model && !PROVIDERS.custom.models.includes(cfg.model)) {
        customModelInp.value = cfg.model;
      }
      keyInp.value = cfg.apiKey || '';
    });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'FEIYU_TOGGLE_PANEL') {
        host.style.display = msg.visible ? 'block' : 'none';
        if (msg.visible) panelBody.style.display = 'block';
        sendResponse?.({ ok: true });
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.showPanel) {
        const visible = changes.showPanel.newValue !== false;
        host.style.display = visible ? 'block' : 'none';
        if (visible) panelBody.style.display = 'block';
      }
      if (changes.provider || changes.apiUrl || changes.model || changes.apiKey) {
        chrome.storage.local.get(['provider', 'apiUrl', 'model', 'apiKey'], (cfg) => {
          const prov = cfg.provider || 'deepseek';
          providerSel.value = prov;
          populateModels(prov, cfg.model);
          urlInp.value = cfg.apiUrl || PROVIDERS[prov]?.url || '';
          if (prov === 'custom' && cfg.model && !PROVIDERS.custom.models.includes(cfg.model)) {
            customModelInp.value = cfg.model;
          }
          keyInp.value = cfg.apiKey || '';
        });
      }
    });

    $('#btn-wide').onclick = () => cardEl.classList.toggle('wide');
    $('#btn-cfg').onclick = () => {
      cfgBox.style.display = cfgBox.style.display === 'none' || !cfgBox.style.display ? 'block' : 'none';
    };
    $('#btn-min').onclick = () => {
      panelBody.style.display = panelBody.style.display === 'none' ? 'block' : 'none';
    };
    $('#btn-hide').onclick = () => {
      host.style.display = 'none';
      chrome.storage.local.set({ showPanel: false });
    };
    $('#qa-close').onclick = () => { qaBox.style.display = 'none'; };

    $('#btn-save-cfg').onclick = async () => {
      const prov = providerSel.value;
      const finalUrl = prov === 'custom' ? urlInp.value.trim() : PROVIDERS[prov].url;
      const finalModel =
        prov === 'custom' && customModelInp.value.trim()
          ? customModelInp.value.trim()
          : modelSel.value;

      if (prov === 'custom' && finalUrl) {
        try {
          const origin = new URL(finalUrl).origin + '/*';
          await chrome.permissions.request({ origins: [origin] });
        } catch {}
      }

      chrome.storage.local.set(
        {
          provider: prov,
          apiUrl: finalUrl,
          model: finalModel,
          apiKey: keyInp.value.trim()
        },
        () => {
          cfgBox.style.display = 'none';
          setStatus(`已保存 (${PROVIDERS[prov].label} · ${finalModel})`);
        }
      );
    };

    let dragging = false, ox = 0, oy = 0;
    $('#drag-header').addEventListener('mousedown', (e) => {
      dragging = true;
      const rect = host.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      host.style.right = 'auto';
      host.style.left = `${Math.max(0, e.clientX - ox)}px`;
      host.style.top = `${Math.max(0, e.clientY - oy)}px`;
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    $('#btn-toggle-trans').onclick = () => {
      translationsHidden = !translationsHidden;
      document.querySelectorAll('.feiyu-bilingual-box').forEach((box) => {
        box.style.display = translationsHidden ? 'none' : 'block';
      });
      setStatus(translationsHidden ? '已隐藏译文' : '已显示译文');
    };

    async function runSelectionAction(actionType, selText, imgEl, customQuestion = '') {
      host.style.display = 'block';
      chrome.storage.local.set({ showPanel: true });
      panelBody.style.display = 'block';
      qaBox.style.display = 'block';
      currentQaText = selText || '';
      currentQaImageEl = imgEl || null;

      if (imgEl && imgEl.src) {
        qaImg.src = imgEl.src;
        qaImg.style.display = 'block';
      } else {
        qaImg.style.display = 'none';
      }

      qaContext.innerText = currentQaText
        ? currentQaText.slice(0, 260) + (currentQaText.length > 260 ? '...' : '')
        : '已选中论文图片/图表';

      if (actionType === 'focus') {
        qaAnswer.innerHTML = '';
        qaInput.focus();
        return;
      }

      qaAnswer.innerHTML = '<p>正在分析，请稍候...</p>';

      let imgDataUrl = null;
      if (imgEl) {
        imgDataUrl = await imageToDataUrl(imgEl);
      }

      const sysPrompt =
        '你是计算机与人工智能顶会科研导师，擅长用通俗直观的例子和严谨公式帮学生吃透论文细节。' +
        '行内公式请使用简洁的 $...$ 格式。';

      let userPrompt = '';
      if (actionType === 'translate') {
        userPrompt = `请精准翻译以下学术内容（包含其中公式的含义），保持专业流畅：\n\n${currentQaText}`;
      } else if (actionType === 'explain') {
        userPrompt =
          `请结合具体通俗的例子（举例说明），深入浅出地解释以下论文片段` +
          `${currentQaText ? `：\n\n${currentQaText}` : '中的图表流程与核心原理。'}`;
      } else {
        userPrompt =
          `针对以下论文内容${currentQaText ? `：\n「${currentQaText}」\n\n` : '（见附图）：\n\n'}` +
          `请回答问题：${customQuestion}`;
      }

      try {
        const reply = await callAI(sysPrompt, userPrompt, imgDataUrl);
        qaAnswer.innerHTML = renderMarkdownToHTML(reply);
      } catch (err) {
        qaAnswer.innerHTML = `<p style="color:#dc2626;">解答失败：${err.message}</p>`;
      }
    }

    $('#qa-send').onclick = () => {
      const q = qaInput.value.trim();
      if (!q) return;
      runSelectionAction('ask', currentQaText, currentQaImageEl, q);
    };
    qaInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#qa-send').click();
    });

    let latestMarkdown = '';
    $('#btn-summary').onclick = async () => {
      const { arxivId, title, pureAuthors, authorsText, abstractText, fullBodyText, codeRepos } = extractPaperInfo();
      if (!abstractText && !fullBodyText) {
        setStatus('未检测到论文正文内容', true);
        return;
      }

      const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(title)}`;
      const codeBannerHtml =
        codeRepos.length > 0
          ? `<div class="code-banner"><span>开源代码</span><a href="${codeRepos[0]}" target="_blank" rel="noopener noreferrer">${codeRepos[0].replace(/^https?:\/\//, '')}</a></div>`
          : `<div class="code-banner none"><span>无代码链接</span><a href="${googleSearchUrl}" target="_blank" rel="noopener noreferrer">Google 搜索论文</a></div>`;

      setStatus('正在生成导读...');
      summaryBox.style.display = 'block';
      summaryBox.innerHTML = `${codeBannerHtml}<p>正在分析全文，请稍候...</p>`;

      const sysPrompt =
        '你是一名资深计算机与人工智能科研学者，请用自然、专业、克制的中文学术笔记风格总结这篇论文。' +
        '要求：\n' +
        '1. 严禁使用“一句话定位”“核弹级”等模板词汇，严禁在标题里带括号解释。\n' +
        '2. 严格按以下小节顺序输出：\n' +
        '## 开源情况\n' +
        '## 作者背景\n' +
        '## 研究动机\n' +
        '## 方法与核心公式\n' +
        '## 实验与消融分析\n' +
        '## 局限与后续思路\n' +
        '3. 开源情况若有链接则给出，无则仅写“无代码链接”。作者背景需先列作者姓名，再结合已知学术背景及文中脚注补充所属机构与研究方向。\n' +
        '4. 行内数学符号请使用简洁规范的 $...$ 格式（避免复杂宏）。';

      const repoHint = codeRepos.length > 0 ? codeRepos.join(' , ') : '无代码链接';
      const userPrompt =
        `论文标题：${title}\n` +
        `作者信息：${authorsText || '未提取到'}\n` +
        `代码链接：${repoHint}\n\n` +
        `摘要：\n${abstractText}\n\n` +
        `${fullBodyText ? `论文全文内容：\n${fullBodyText}` : ''}`;

      try {
        const reply = await callAI(sysPrompt, userPrompt);
        const codeLine = codeRepos.length > 0 ? `> 开源代码：${codeRepos[0]}\n` : '';
        latestMarkdown = `# ${title}\n\n> 原文链接：${location.href}\n${codeLine}\n${reply}`;
        summaryBox.innerHTML = codeBannerHtml + renderMarkdownToHTML(reply);
        copyMdBtn.style.display = 'block';
        setStatus('导读生成完成（已自动记录到已读列表）');

        saveReadingHistory({
          arxivId,
          title,
          authors: pureAuthors,
          url: location.href,
          codeRepo: codeRepos[0] || '',
          summary: reply,
          readAt: Date.now()
        });
      } catch (err) {
        summaryBox.innerHTML = `${codeBannerHtml}<p style="color:#dc2626;">生成失败：${err.message}</p>`;
        setStatus(err.message, true);
      }
    };

    copyMdBtn.onclick = async () => {
      if (!latestMarkdown) return;
      await navigator.clipboard.writeText(latestMarkdown);
      setStatus('已复制 Markdown 笔记');
    };

    const transBtn = $('#btn-translate');
    let translating = false;

    transBtn.onclick = async () => {
      if (translating) {
        stopBatchFlag = true;
        setStatus('正在停止...');
        return;
      }

      const paras = getTranslatableParagraphs();
      if (paras.length === 0) {
        setStatus('未找到可翻译段落', true);
        return;
      }

      translating = true;
      stopBatchFlag = false;
      transBtn.innerText = '停止翻译';

      for (let i = 0; i < paras.length; i++) {
        if (stopBatchFlag) break;
        setStatus(`正在翻译第 ${i + 1} / ${paras.length} 段...`);
        await translateParagraph(paras[i]);
      }

      translating = false;
      transBtn.innerText = isHtmlPaper ? '全文翻译' : '翻译摘要';
      setStatus(stopBatchFlag ? '已暂停翻译' : '翻译完成');
    };

    const floatBar = document.createElement('div');
    floatBar.id = 'feiyu-sel-toolbar';
    floatBar.style.cssText = `
      position: fixed; display: none; z-index: 2147483647;
      background: #1e293b; color: #fff; border-radius: 6px; padding: 3px 5px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.22); gap: 3px; align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 12px;
    `;
    const mkBarBtn = (label, onClick) => {
      const b = document.createElement('button');
      b.innerText = label;
      b.style.cssText = `
        background: transparent; color: #f8fafc; border: none; padding: 4px 8px;
        border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;
      `;
      b.onmouseenter = () => { b.style.background = '#334155'; };
      b.onmouseleave = () => { b.style.background = 'transparent'; };
      b.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
      b.onclick = (e) => { e.stopPropagation(); floatBar.style.display = 'none'; onClick(); };
      return b;
    };

    let lastSel = { text: '', imgEl: null };
    floatBar.appendChild(mkBarBtn('翻译', () => runSelectionAction('translate', lastSel.text, lastSel.imgEl)));
    floatBar.appendChild(mkBarBtn('举例解释', () => runSelectionAction('explain', lastSel.text, lastSel.imgEl)));
    floatBar.appendChild(mkBarBtn('问 AI', () => runSelectionAction('focus', lastSel.text, lastSel.imgEl)));
    document.body.appendChild(floatBar);

    document.addEventListener('mouseup', (e) => {
      if (e.target.closest('#feiyu-arxiv-host, #feiyu-sel-toolbar')) return;
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          floatBar.style.display = 'none';
          return;
        }
        const range = sel.getRangeAt(0);
        const { text, imgEl } = extractSelectionPayload(range);
        if (!text && !imgEl) {
          floatBar.style.display = 'none';
          return;
        }
        lastSel = { text, imgEl };
        const rect = range.getBoundingClientRect();
        floatBar.style.left = `${Math.min(window.innerWidth - 200, Math.max(10, rect.left))}px`;
        floatBar.style.top = `${Math.max(10, rect.top - 38)}px`;
        floatBar.style.display = 'flex';
      }, 20);
    });

    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('#feiyu-sel-toolbar')) {
        floatBar.style.display = 'none';
      }
    });

    document.querySelectorAll('figure.ltx_figure, figure.ltx_table').forEach((fig) => {
      const img = fig.querySelector('img');
      const caption = getCleanText(fig.querySelector('figcaption'));
      if (!img && !caption) return;
      fig.style.position = 'relative';

      const figBtn = document.createElement('button');
      figBtn.className = 'feiyu-fig-btn';
      figBtn.innerText = '解释此图';
      figBtn.style.cssText = `
        position: absolute; top: 8px; right: 8px; z-index: 15;
        background: rgba(43, 103, 255, 0.9); color: #fff; border: none;
        padding: 4px 9px; border-radius: 5px; font-size: 11px; font-weight: 600;
        cursor: pointer; opacity: 0.25; transition: opacity 0.15s;
      `;
      fig.addEventListener('mouseenter', () => { figBtn.style.opacity = '1'; });
      fig.addEventListener('mouseleave', () => { figBtn.style.opacity = '0.25'; });
      figBtn.onclick = (e) => {
        e.stopPropagation();
        runSelectionAction('explain', caption || '请结合附图解释该图表内容', img);
      };
      fig.appendChild(figBtn);
    });
  }

  function attachInlineTranslateTriggers() {
    const paras = getTranslatableParagraphs();
    for (const p of paras) {
      if (p.dataset.feiyuBtnAttached === '1') continue;
      p.dataset.feiyuBtnAttached = '1';
      p.style.position = 'relative';

      const btn = document.createElement('button');
      btn.className = 'feiyu-inline-btn';
      btn.innerText = '译';
      btn.title = '翻译本段';
      btn.style.cssText = `
        position: absolute;
        left: -26px;
        top: 2px;
        width: 20px;
        height: 20px;
        line-height: 18px;
        text-align: center;
        font-size: 11px;
        background: #eff6ff;
        color: #2b67ff;
        border: 1px solid #bfdbfe;
        border-radius: 4px;
        cursor: pointer;
        opacity: 0.35;
        transition: opacity 0.15s;
        padding: 0;
        z-index: 10;
      `;
      p.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
      p.addEventListener('mouseleave', () => { btn.style.opacity = '0.35'; });
      btn.onclick = (e) => {
        e.stopPropagation();
        translateParagraph(p);
      };
      p.appendChild(btn);
    }
  }

  attachInlineTranslateTriggers();
  mountPanel();
})();
