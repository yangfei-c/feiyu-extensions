// 飞羽 · arXiv 论文助手 - Popup：Markdown 与 BibTeX 导出
(() => {
  'use strict';

  const F = (window.FeiyuArxiv = window.FeiyuArxiv || {});

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
  function exportMarkdown(hist) {
    if (hist.length === 0) {
      return { ok: false, message: '暂无已读记录，请先在论文页生成导读' };
    }
    const md = hist
      .map((item) => {
        const timeStr = new Date(item.readAt).toLocaleString();
        return `# ${item.title}\n\n- arXiv: ${item.url}\n- 阅读时间: ${timeStr}\n${item.codeRepo ? `- 开源代码: ${item.codeRepo}\n` : ''}\n${item.summary || ''}\n\n---\n`;
      })
      .join('\n');
    return {
      ok: true,
      filename: 'feiyu-arxiv-notes.md',
      content: md,
      mimeType: 'text/markdown;charset=utf-8',
      message: `已导出 ${hist.length} 篇 Markdown 笔记`
    };
  }

  // 导出为 BibTeX 格式，可直接拖入 Zotero 导入文献库
  function exportBibTeX(hist) {
    if (hist.length === 0) {
      return { ok: false, message: '暂无已读记录' };
    }
    const bib = hist
      .map((item, idx) => {
        const id = (item.arxivId || `arxiv_${idx + 1}`).replace(/[^a-zA-Z0-9_]/g, '_');
        const year = (item.arxivId || '').match(/^(\d{2})/) ? '20' + item.arxivId.slice(0, 2) : '2026';
        return `@article{${id},\n  title={${item.title}},\n  author={${item.authors || 'arXiv Authors'}},\n  year={${year}},\n  eprint={${item.arxivId || ''}},\n  archivePrefix={arXiv},\n  url={${item.url}}\n}`;
      })
      .join('\n\n');
    return {
      ok: true,
      filename: 'feiyu-arxiv-papers.bib',
      content: bib,
      mimeType: 'text/plain;charset=utf-8',
      message: `已导出 ${hist.length} 篇 BibTeX，可导入 Zotero`
    };
  }

  F.export = {
    downloadFile,
    exportMarkdown,
    exportBibTeX
  };
})();
