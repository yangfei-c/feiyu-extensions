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

  // 读取页面 meta 标签中的引文信息（DOI、期刊名、发布日期等）
  function getCitationMeta(name) {
    return document.querySelector(`meta[name="${name}"]`)?.content || '';
  }

  // 是否为 ScienceDirect 论文页（根据 hostname 区分）
  function isScienceDirectPage() {
    return /(^|\.)sciencedirect\.com$/i.test(location.hostname);
  }

  // 定位 ScienceDirect 摘要正文：找到文本为 "Abstract" 的标题，
  // 取其下一个含实质文字、且非图形的兄弟节点（不依赖 id/class 命名，
  // 兼容 as010 / d1e1810 / abss0001 等不同模板）。
  function getScienceDirectAbstractEl() {
    const heading = Array.from(document.querySelectorAll('h2.section-title, h2, h3')).find(
      (h) => h.textContent.trim().toLowerCase() === 'abstract'
    );
    if (!heading || !heading.parentElement) return null;
    const container = heading.parentElement;

    let sibling = heading.nextElementSibling;
    while (sibling) {
      if (!sibling.querySelector('figure')) {
        const t = (sibling.innerText || '').trim();
        if (t.length > 20) return sibling;
      }
      sibling = sibling.nextElementSibling;
    }
    return container;
  }

  // 判断某 div 是否为「纯公式容器」：去掉公式节点后几乎没有文字
  function isPureFormulaContainer(el) {
    if (el.tagName !== 'DIV') return false;
    const clone = el.cloneNode(true);
    clone.querySelectorAll('span.math, mjx-container, span.formula, math').forEach((n) => n.remove());
    const leftover = (clone.innerText || clone.textContent || '').replace(/\s+/g, '');
    return leftover.length < 3;
  }

  // 收集 ScienceDirect 正文节点（小标题 + 段落 div，按文档顺序，去重去噪）
  function getScienceDirectBodyNodes() {
    const body = document.querySelector('#body');
    if (!body) return [];
    return Array.from(
      body.querySelectorAll('h2, h3, div[id^="p"], div[id^="d1e"], section > div')
    ).filter((el) => {
      if (el.closest('.bibliography, .references, #feiyu-arxiv-host')) return false;
      if (el.classList && el.classList.contains('section-title')) return false;
      if (el.tagName === 'DIV') {
        if (el.querySelector('div[id^="p"], div[id^="d1e"]')) return false; // 跳过包裹层，避免与内层段落重复
        if (el.querySelector('figure, table')) return false; // 跳过图表占位
      }
      return true;
    });
  }

  // 判断某元素是否为章节标题
  function isHeadingEl(el) {
    return /^H[1-6]$/.test(el.tagName);
  }

  // 判断某元素是否可作为可翻译段落（标题较短即可，段落需有实质长度）
  function isTranslatableEl(el) {
    const t = (el.innerText || '').trim();
    return t.length >= (isHeadingEl(el) ? 3 : 25);
  }

  // 从当前网页真实 DOM 动态识别章节，返回 [{ id, title, elements }]。
  // 严禁写死/编造章节；兼容 arXiv/ar5iv 与 ScienceDirect。
  function extractSections() {
    if (isScienceDirectPage()) return extractScienceDirectSections();
    return extractArxivSections();
  }

  function extractArxivSections() {
    const sections = [];
    const isHtmlPaper = window.FeiyuArxiv.state.isHtmlPaper;

    // 摘要作为第一节
    const absEl = document.querySelector('.ltx_abstract') || document.querySelector('blockquote.abstract');
    if (absEl) {
      const absParas = Array.from(absEl.querySelectorAll('p')).filter((p) => (p.innerText || '').trim().length >= 25);
      sections.push({ id: 'abstract', title: 'Abstract', elements: absParas.length ? absParas : [absEl] });
    }

    if (!isHtmlPaper) return sections; // 摘要页仅返回摘要节

    const nodes = Array.from(
      document.querySelectorAll('h2.ltx_title_section, h3.ltx_title_subsection, p.ltx_p')
    ).filter((el) => !el.closest('.ltx_bibliography, .ltx_authors, #feiyu-arxiv-host'));

    const hasH2 = nodes.some((n) => n.tagName === 'H2');
    let current = null;

    if (hasH2) {
      for (const node of nodes) {
        if (node.tagName === 'H2') {
          if (current) sections.push(current);
          current = { id: `sec_${sections.length}`, title: getCleanText(node), elements: [node] };
        } else if (current) {
          if (isTranslatableEl(node)) current.elements.push(node);
        }
      }
      if (current) sections.push(current);
    } else {
      // 兜底：部分页面用 <section class="ltx_section"> 包裹章节
      document.querySelectorAll('section.ltx_section').forEach((sec, i) => {
        const head = sec.querySelector('h2, h3, .ltx_title_section, .ltx_title_subsection');
        const title = getCleanText(head) || `Section ${i + 1}`;
        const els = Array.from(sec.querySelectorAll('p.ltx_p')).filter((p) => (p.innerText || '').trim().length >= 25);
        if (head) els.unshift(head);
        sections.push({ id: `sec_${sections.length}`, title, elements: els });
      });
    }

    return sections;
  }

  function extractScienceDirectSections() {
    const sections = [];

    // 摘要作为第一节
    const absEl = getScienceDirectAbstractEl();
    if (absEl) {
      sections.push({ id: 'abstract', title: 'Abstract', elements: [absEl] });
    }

    const body = document.querySelector('#body');
    if (!body) return sections; // 摘要页仅返回摘要节

    let current = null;
    for (const el of getScienceDirectBodyNodes()) {
      if (el.tagName === 'H2') {
        if (current) sections.push(current);
        current = { id: `sec_${sections.length}`, title: getCleanText(el), elements: [el] };
      } else if (current) {
        if (isTranslatableEl(el)) current.elements.push(el);
      }
    }
    if (current) sections.push(current);

    return sections;
  }

  function extractScienceDirectPaperInfo() {
    const titleEl =
      document.querySelector('h1 .title-text') ||
      document.querySelector('h1');
    const title = getCleanText(titleEl) || document.title;

    // 作者：仅从 #author-group 内拼接 .given-name + .surname（严禁使用 .authors）
    const authorGroup = document.querySelector('#author-group');
    const authorNames = [];
    if (authorGroup) {
      authorGroup.querySelectorAll('button.button-link, a.anchor[href*="/author/"]').forEach((node) => {
        const given = (node.querySelector('.given-name')?.textContent || '').trim();
        const surname = (node.querySelector('.surname')?.textContent || '').trim();
        const name = `${given} ${surname}`.trim();
        if (name) authorNames.push(name);
      });
    }
    const pureAuthors = authorNames.join(', ');

    const absEl = getScienceDirectAbstractEl();
    const abstractText = getCleanText(absEl).replace(/^Abstract\s*/i, '').trim();

    const fullBodyText = extractScienceDirectFullBody();

    const arxivId =
      (location.pathname.match(/\/pii\/([^/?#]+)/) || [])[1] || location.pathname;

    // 期刊名与 DOI：优先从 meta 标签读取，再回退到页面元素
    const journal =
      getCitationMeta('citation_journal_title') ||
      getCleanText(document.querySelector('.publication-title'));
    const doi = getCitationMeta('citation_doi');
    const year = (getCitationMeta('citation_publication_date').match(/^(\d{4})/) || [])[1] || '';

    return {
      arxivId,
      title,
      pureAuthors,
      authorsText: pureAuthors,
      abstractText,
      fullBodyText,
      codeRepos: [],
      journal,
      doi,
      year,
      source: 'sciencedirect'
    };
  }

  function extractScienceDirectFullBody() {
    const nodes = getScienceDirectBodyNodes();
    const chunks = [];
    for (const el of nodes) {
      const t = getCleanText(el);
      if (!t) continue;
      if (el.tagName === 'H2') chunks.push(`\n## ${t}`);
      else if (el.tagName === 'H3') chunks.push(`\n### ${t}`);
      else if (t.length >= 25) chunks.push(t);
    }
    return chunks.join('\n\n').slice(0, 36000);
  }

  function getScienceDirectTranslatableParagraphs() {
    const list = [];
    const titleEl = document.querySelector('h1');
    if (titleEl) list.push(titleEl);

    const absEl = getScienceDirectAbstractEl();
    if (absEl) list.push(absEl);

    for (const el of getScienceDirectBodyNodes()) {
      if (isPureFormulaContainer(el)) continue;
      const t = (el.innerText || '').trim();
      const isHeading = /^H[1-6]$/.test(el.tagName);
      if (t.length < (isHeading ? 3 : 25)) continue;
      list.push(el);
    }
    return list;
  }

  function extractPaperInfo() {
    if (isScienceDirectPage()) return extractScienceDirectPaperInfo();

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

    const journal = getCitationMeta('citation_journal_title');
    const doi = getCitationMeta('citation_doi');
    const year = (getCitationMeta('citation_publication_date').match(/^(\d{4})/) || [])[1] || '';

    return { arxivId, title, pureAuthors, authorsText, abstractText, fullBodyText, codeRepos, journal, doi, year, source: 'arxiv' };
  }

  function getTranslatableParagraphs() {
    if (isScienceDirectPage()) return getScienceDirectTranslatableParagraphs();

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

  // 探测当前页面对应的 PDF 地址（用于无 HTML 正文时的全文兜底）
  function getPdfUrl() {
    // arXiv abs/html 页 → /pdf/<id>
    if (location.hostname.includes('arxiv.org') || location.hostname.includes('ar5iv')) {
      const m = location.pathname.match(/\/(?:abs|html)\/([^/?#]+)/);
      return m ? `https://arxiv.org/pdf/${m[1]}` : null;
    }
    // ScienceDirect 文章页 → 优先取与当前 PII 一致的 View PDF 链接
    if (isScienceDirectPage()) {
      const pii = (location.pathname.match(/\/pii\/([^/?#]+)/) || [])[1] || '';
      const links = Array.from(document.querySelectorAll('a[href]'));
      let link = pii
        ? links.find((a) => (a.href || '').includes(pii) && /\/pdf(f|t)?(\?|$)/i.test(a.href))
        : null;
      if (!link) {
        link = links.find((a) => /^(view|download)\s+pdf$/i.test((a.textContent || '').trim()));
      }
      return link ? link.href : null;
    }
    return null;
  }

  F.extractor = {
    extractSelectionPayload,
    detectCodeRepos,
    getCleanText,
    extractPaperInfo,
    getTranslatableParagraphs,
    extractSections,
    getPdfUrl,
    isScienceDirectPage
  };
})();
