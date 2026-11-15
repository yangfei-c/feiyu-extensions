// 飞羽 · B站学习助手 - Content Script：Markdown 渲染与时间戳按钮
(() => {
  'use strict';

  const F = (window.FeiyuBili = window.FeiyuBili || {});

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // 匹配 [MM:SS] 或 [H:MM:SS]，换算为秒
  const TS_PATTERN = /\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/g;

  function timestampToSeconds(p1, p2, p3) {
    if (p3 !== undefined) {
      return Number(p1) * 3600 + Number(p2) * 60 + Number(p3);
    }
    return Number(p1) * 60 + Number(p2);
  }

  // 行内格式化：时间戳按钮 + 加粗 + 行内代码 + 链接
  function formatInline(str) {
    const tsTokens = new Map();
    let tsIdx = 0;

    const withTs = str.replace(TS_PATTERN, (match, p1, p2, p3) => {
      const sec = timestampToSeconds(p1, p2, p3);
      const label = match.slice(1, -1);
      const key = `__FYYTS${tsIdx++}__`;
      tsTokens.set(key, `<button class="ts-btn" data-sec="${sec}" title="跳到 ${label}">${label}</button>`);
      return key;
    });

    let html = withTs
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(
        /(https?:\/\/[^\s)<>]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
      );

    for (const [key, value] of tsTokens.entries()) {
      html = html.split(key).join(value);
    }
    return html;
  }

  function renderMarkdownToHTML(mdText) {
    const escaped = escapeHtml(mdText);
    const lines = escaped.split('\n');
    const parts = [];
    let inList = false;

    const closeList = () => {
      if (inList) {
        parts.push('</ul>');
        inList = false;
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        closeList();
        continue;
      }

      if (/^#{1,4}\s+/.test(line)) {
        closeList();
        const level = Math.min(line.match(/^(#{1,4})/)[1].length, 3);
        const text = formatInline(line.replace(/^#{1,4}\s+/, ''));
        parts.push(`<div class="md-h${level}">${text}</div>`);
      } else if (/^[-*•]\s+/.test(line)) {
        if (!inList) {
          parts.push('<ul>');
          inList = true;
        }
        parts.push(`<li>${formatInline(line.replace(/^[-*•]\s+/, ''))}</li>`);
      } else if (/^\d+[.)]\s+/.test(line)) {
        closeList();
        parts.push(`<div class="md-num">${formatInline(line)}</div>`);
      } else if (/^&gt;\s?/.test(line)) {
        closeList();
        parts.push(`<div class="md-quote">${formatInline(line.replace(/^&gt;\s?/, ''))}</div>`);
      } else {
        closeList();
        parts.push(`<p>${formatInline(line)}</p>`);
      }
    }

    closeList();
    return parts.join('');
  }

  F.render = {
    escapeHtml,
    formatInline,
    renderMarkdownToHTML
  };
})();
