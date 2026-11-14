// 飞羽 · arXiv 论文助手 - Content Script：公式与 Markdown 渲染、占位符保护
(() => {
  'use strict';

  const F = (window.FeiyuArxiv = window.FeiyuArxiv || {});

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

  F.render = {
    latexToHtml,
    renderMarkdownToHTML,
    serializeWithPlaceholders,
    restorePlaceholdersToHTML
  };
})();
