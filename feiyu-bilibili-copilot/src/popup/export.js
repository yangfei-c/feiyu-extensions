// 飞羽 · B站学习助手 - Popup：Markdown 批量导出
(() => {
  'use strict';

  const F = (window.FeiyuBili = window.FeiyuBili || {});

  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // 导出全部视频笔记为 Markdown 合集
  function exportMarkdown(notes) {
    if (!Array.isArray(notes) || notes.length === 0) {
      return { ok: false, message: '暂无笔记记录，请先在视频页生成总结' };
    }
    const md = notes
      .map((item) => {
        const timeStr = new Date(item.at || Date.now()).toLocaleString();
        const partInfo =
          item.p && item.p > 1 ? `\n- 分P：P${item.p}` : '';
        const sourceLabel = item.source === 'danmaku' ? '（基于弹幕概览）' : '';
        return (
          `# ${item.title || '(无标题)'}${sourceLabel}\n\n` +
          `- 视频：${item.url || ''}\n` +
          `- UP主：${item.upName || '未知'}${partInfo}\n` +
          `- 记录时间：${timeStr}\n\n` +
          `${item.summary || ''}\n\n---\n`
        );
      })
      .join('\n');
    return {
      ok: true,
      filename: 'feiyu-bilibili-notes.md',
      content: md,
      mimeType: 'text/markdown;charset=utf-8',
      message: `已导出 ${notes.length} 条 Markdown 笔记`
    };
  }

  F.export = { downloadFile, exportMarkdown };
})();
