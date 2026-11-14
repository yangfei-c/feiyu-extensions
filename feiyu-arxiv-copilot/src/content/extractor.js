// 飞羽 · arXiv 论文助手 - Content Script：论文抓取与代码检测、划词提取
(() => {
  'use strict';

  const F = (window.FeiyuArxiv = window.FeiyuArxiv || {});

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
    const isHtmlPaper = window.FeiyuArxiv.state.isHtmlPaper;

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

  function getTranslatableParagraphs() {
    const isHtmlPaper = window.FeiyuArxiv.state.isHtmlPaper;
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

  F.extractor = {
    extractSelectionPayload,
    detectCodeRepos,
    getCleanText,
    extractPaperInfo,
    getTranslatableParagraphs
  };
})();
