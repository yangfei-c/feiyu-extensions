// 飞羽 · arXiv 论文助手 - Content Script：面板 UI、划词工具条、图片按钮
(() => {
  'use strict';

  const F = (window.FeiyuArxiv = window.FeiyuArxiv || {});

  async function mountPanel() {
    const { isHtmlPaper } = F.state;

    const host = document.createElement('div');
    host.id = 'feiyu-arxiv-host';
    host.style.cssText = 'position:fixed;top:64px;right:20px;z-index:2147483647;';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    let css = '';
    try {
      const res = await fetch(chrome.runtime.getURL('src/content/panel.css'));
      css = await res.text();
    } catch {
      css = '';
    }

    shadow.innerHTML = `
      <style>${css}</style>
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
      const p = F.PROVIDERS[providerKey] || F.PROVIDERS.deepseek;
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
      urlInp.value = cfg.apiUrl || F.PROVIDERS[prov]?.url || '';
      if (prov === 'custom' && cfg.model && !F.PROVIDERS.custom.models.includes(cfg.model)) {
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
          urlInp.value = cfg.apiUrl || F.PROVIDERS[prov]?.url || '';
          if (prov === 'custom' && cfg.model && !F.PROVIDERS.custom.models.includes(cfg.model)) {
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
      const finalUrl = prov === 'custom' ? urlInp.value.trim() : F.PROVIDERS[prov].url;
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
          setStatus(`已保存 (${F.PROVIDERS[prov].label} · ${finalModel})`);
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
      F.state.translationsHidden = !F.state.translationsHidden;
      document.querySelectorAll('.feiyu-bilingual-box').forEach((box) => {
        box.style.display = F.state.translationsHidden ? 'none' : 'block';
      });
      setStatus(F.state.translationsHidden ? '已隐藏译文' : '已显示译文');
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
        imgDataUrl = await F.app.imageToDataUrl(imgEl);
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
        const reply = await F.app.callAI(sysPrompt, userPrompt, imgDataUrl);
        qaAnswer.innerHTML = F.render.renderMarkdownToHTML(reply);
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
      const { arxivId, title, pureAuthors, authorsText, abstractText, fullBodyText, codeRepos } = F.extractor.extractPaperInfo();
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
        const reply = await F.app.callAI(sysPrompt, userPrompt);
        const codeLine = codeRepos.length > 0 ? `> 开源代码：${codeRepos[0]}\n` : '';
        latestMarkdown = `# ${title}\n\n> 原文链接：${location.href}\n${codeLine}\n${reply}`;
        summaryBox.innerHTML = codeBannerHtml + F.render.renderMarkdownToHTML(reply);
        copyMdBtn.style.display = 'block';
        setStatus('导读生成完成（已自动记录到已读列表）');

        F.app.saveReadingHistory({
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
        F.state.stopBatchFlag = true;
        setStatus('正在停止...');
        return;
      }

      const paras = F.extractor.getTranslatableParagraphs();
      if (paras.length === 0) {
        setStatus('未找到可翻译段落', true);
        return;
      }

      translating = true;
      F.state.stopBatchFlag = false;
      transBtn.innerText = '停止翻译';

      for (let i = 0; i < paras.length; i++) {
        if (F.state.stopBatchFlag) break;
        setStatus(`正在翻译第 ${i + 1} / ${paras.length} 段...`);
        await F.app.translateParagraph(paras[i]);
      }

      translating = false;
      transBtn.innerText = isHtmlPaper ? '全文翻译' : '翻译摘要';
      setStatus(F.state.stopBatchFlag ? '已暂停翻译' : '翻译完成');
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
        const { text, imgEl } = F.extractor.extractSelectionPayload(range);
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
      const caption = F.extractor.getCleanText(fig.querySelector('figcaption'));
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
    const paras = F.extractor.getTranslatableParagraphs();
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
        F.app.translateParagraph(p);
      };
      p.appendChild(btn);
    }
  }

  F.panel = {
    mountPanel,
    attachInlineTranslateTriggers
  };
})();
