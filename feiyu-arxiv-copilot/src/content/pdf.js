// 飞羽 · 学术论文助手 - Content Script：本地 pdf.js 加载与 PDF 文本提取
(() => {
  'use strict';

  const F = (window.FeiyuArxiv = window.FeiyuArxiv || {});

  let pdfjsPromise = null;

  // 懒加载本地 pdf.js（web_accessible 资源，严禁远程 CDN）
  function getPdfjs() {
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = (async () => {
      const pdfjs = await import(chrome.runtime.getURL('src/lib/pdf.min.mjs'));
      pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('src/lib/pdf.worker.min.mjs');
      return pdfjs;
    })();
    return pdfjsPromise;
  }

  // 校验前 4 字节是否为 %PDF
  function isPdfBuffer(buf) {
    if (!buf || buf.byteLength < 4) return false;
    const b = new Uint8Array(buf, 0, 4);
    return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
  }

  function assertPdfBuffer(buf) {
    if (!isPdfBuffer(buf)) {
      throw new Error('无法直接读取该网站受保护的 PDF 内容（可能受防盗链或人机验证限制）');
    }
    return buf;
  }

  // 直接同源 fetch（纯 PDF 页优先），并校验 %PDF
  async function fetchPdfDirect(url) {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) throw new Error(`PDF 下载失败：HTTP ${resp.status}`);
    return assertPdfBuffer(await resp.arrayBuffer());
  }

  // 通过 Service Worker 下载（跨域安全），并校验 %PDF
  async function fetchPdfViaWorker(url) {
    const base64 = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'FEIYU_FETCH_PDF', payload: { url } }, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!res?.ok) {
          reject(new Error(res?.error || 'PDF 下载失败'));
          return;
        }
        resolve(res.base64);
      });
    });
    return assertPdfBuffer(base64ToArrayBuffer(base64));
  }

  // 组合下载：preferDirect 时优先同源直取，失败回退 service worker；二者均校验 %PDF
  async function fetchPdfAsArrayBuffer(url, opts = {}) {
    let lastError = null;
    if (opts.preferDirect) {
      try {
        return await fetchPdfDirect(url);
      } catch (e) {
        lastError = e;
      }
    }
    try {
      return await fetchPdfViaWorker(url);
    } catch (e) {
      lastError = e;
    }
    throw new Error(lastError?.message || 'PDF 下载失败');
  }

  function base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // 抽取单页文本，尽量保留行结构
  async function extractPageText(page) {
    const content = await page.getTextContent();
    const lines = [];
    let line = '';
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line.replace(/\s+/g, ' ').trim());
        line = '';
      } else {
        line += ' ';
      }
    }
    if (line.trim()) lines.push(line.replace(/\s+/g, ' ').trim());
    return lines.join('\n');
  }

  // 拷贝 buffer 后再交给 getDocument，避免 pdf.js 将原 buffer 转移给 Worker 后 detached；
  // getDocument 返回 LoadingTask，需取其 .promise 得到真正的 PDFDocumentProxy。
  // verbosity: 0（ERRORS）只记录致命错误，屏蔽字体解析等无害 Warning。
  async function getDocumentSafe(arrayBuffer) {
    const pdfjs = await getPdfjs();
    const copy = new Uint8Array(arrayBuffer.slice(0));
    return await pdfjs.getDocument({ data: copy, verbosity: 0 }).promise;
  }

  // 提取全部页文本数组：['第1页文本', '第2页文本', ...]
  async function extractPages(arrayBuffer, onProgress) {
    const doc = await getDocumentSafe(arrayBuffer);
    const pages = [];
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        pages.push(await extractPageText(page));
        onProgress?.(i, doc.numPages);
      }
      return pages;
    } finally {
      // pdf.js v6 的 proxy 用 cleanup()；旧版用 destroy()，做兼容保护
      if (doc) {
        if (typeof doc.destroy === 'function') await doc.destroy();
        else if (typeof doc.cleanup === 'function') await doc.cleanup();
      }
    }
  }

  F.pdf = {
    getPdfjs,
    fetchPdfAsArrayBuffer,
    base64ToArrayBuffer,
    extractPages,
    isPdfBuffer
  };
})();
