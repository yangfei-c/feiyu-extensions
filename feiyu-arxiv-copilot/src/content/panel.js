// 飞羽 · arXiv 论文助手 - Content Script：面板 UI、划词工具条、图片按钮
(() => {
  'use strict';

  const F = (window.FeiyuArxiv = window.FeiyuArxiv || {});

  async function mountPanel() {
    const { isHtmlPaper, isScienceDirect, isPdfPage } = F.state;
    const isFullTextPage = isHtmlPaper || (isScienceDirect && !!document.querySelector('#body'));

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
          <div class="title">飞羽 · 学术论文助手</div>
          <div class="actions">
            <span id="btn-wide" title="全高侧边栏 / 紧凑浮窗">⤢</span>
            <span id="btn-cfg" title="模型设置">⚙</span>
            <span id="btn-min" title="折叠">—</span>
            <span id="btn-hide" title="隐藏面板（可在右上角扩展图标重新开启）">✕</span>
          </div>
        </div>
        <div class="tabs" id="tabs">
          <button class="tab active" data-tab="summary">导读</button>
          <button class="tab" data-tab="trans">译文</button>
          <button class="tab" data-tab="qa">问答</button>
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
            <button class="btn-primary btn-block" id="btn-save-cfg">保存配置</button>
          </div>

          <div class="tab-panel active" id="tab-summary">
            <div class="mode-row">
              <span class="mode-label">导读</span>
              <button class="mode-btn active" id="guide-quick">摘要快读</button>
              <button class="mode-btn" id="guide-full">全文精读</button>
            </div>
            <div class="guide-hint" id="guide-hint">仅分析摘要，适合快速筛论文</div>
            <button class="btn-primary btn-block" id="btn-summary">生成导读</button>
            <div class="status" id="status-summary"></div>
            <div class="summary-box" id="summary-box"></div>
            <button class="btn-outline" id="btn-copy-md" style="display:none;">复制 Markdown 笔记</button>
          </div>

          <div class="tab-panel" id="tab-trans">
            ${isPdfPage ? `
            <div class="pdf-range-row">
              <span class="mode-label">页码</span>
              <input id="pdf-range" type="text" placeholder="如 1-2 或 1,3,5" />
            </div>
            ` : `
            <div class="mode-row">
              <span class="mode-label">范围</span>
              <button class="mode-btn active" id="trans-visible" title="省钱推荐：仅翻译视口内未翻译段落">当前可见段</button>
              <button class="mode-btn" id="trans-sections" title="勾选要翻译的章节">按章节</button>
              <button class="mode-btn" id="trans-all" title="全篇逐段翻译">全篇</button>
            </div>
            <div class="section-list" id="section-list" style="display:none;"></div>
            <button class="btn-ghost btn-block" id="btn-toggle-trans" title="隐藏/显示译文">显隐</button>
            `}
            <button class="btn-green btn-block" id="btn-translate">开始翻译</button>
            <div class="status" id="status-trans"></div>
            ${isPdfPage ? `<div class="pdf-trans-out" id="pdf-trans-out"></div>` : `<div class="trans-hint">译文将逐段显示在页面原文下方，可点「显隐」切换。</div>`}
          </div>

          <div class="tab-panel" id="tab-qa">
            <div class="qa-box" id="qa-box">
              <div class="qa-head">
                <strong>选区问答</strong>
                <span id="qa-close">✕</span>
              </div>
              <div class="qa-img-wrap" id="qa-img-wrap">
                <img id="qa-img" class="qa-img-preview" />
                <span id="qa-clear-img" class="qa-clear-img" title="清除已粘贴的图片" style="display:none;">✕</span>
              </div>
              <div class="qa-context" id="qa-context"></div>
              <div class="qa-input-row">
                <input id="qa-input" type="text" placeholder="输入问题（如：举例解释、推导公式；也可 Ctrl+V 粘贴截图）" />
                <button class="btn-primary" id="qa-send">提问</button>
              </div>
              <div class="status" id="status-qa"></div>
              <div class="qa-hint">支持在 PDF 中按 Win+Shift+S 截图后在此 Ctrl+V 粘贴识图</div>
              <div class="qa-answer" id="qa-answer"></div>
            </div>
          </div>

          <div class="footer-note">支持 arXiv 与 ScienceDirect 论文页面 · 需自行配置模型 API Key</div>
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
    const statusEls = {
      summary: $('#status-summary'),
      trans: $('#status-trans'),
      qa: $('#status-qa')
    };
    const summaryBox = $('#summary-box');
    const copyMdBtn = $('#btn-copy-md');
    const cfgBox = $('#cfg-box');
    const panelBody = $('#panel-body');

    const qaBox = $('#qa-box');
    const qaImg = $('#qa-img');
    const qaClearBtn = $('#qa-clear-img');
    const qaContext = $('#qa-context');
    const qaInput = $('#qa-input');
    const qaAnswer = $('#qa-answer');

    const guideQuickBtn = $('#guide-quick');
    const guideFullBtn = $('#guide-full');
    const guideHintEl = $('#guide-hint');
    const transVisibleBtn = $('#trans-visible');
    const transSectionsBtn = $('#trans-sections');
    const transAllBtn = $('#trans-all');
    const sectionList = $('#section-list');
    const pdfRangeInput = $('#pdf-range');
    const pdfTransOut = $('#pdf-trans-out');
    const tabButtons = Array.from(shadow.querySelectorAll('.tab'));
    const tabSummary = $('#tab-summary');
    const tabTrans = $('#tab-trans');
    const tabQa = $('#tab-qa');

    let currentQaText = '';
    let currentQaImageEl = null;
    let currentQaImageDataUrl = null;

    // 每个 Tab 独立的「状态行」，仅在各自 Tab 内更新，互不串台
    function setTabStatus(tab, msg, isErr = false) {
      const el = statusEls[tab];
      if (!el) return;
      el.className = isErr ? 'status err' : 'status';
      el.innerText = msg;
    }

    let activeTab = 'summary';

    function switchTab(name) {
      activeTab = name;
      tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
      tabSummary.classList.toggle('active', name === 'summary');
      if (tabTrans) tabTrans.classList.toggle('active', name === 'trans');
      tabQa.classList.toggle('active', name === 'qa');
    }

    // 默认写给「导读」Tab；译文/问答在各自函数内用局部别名覆盖
    const setStatus = (msg, isErr = false) => setTabStatus('summary', msg, isErr);

    tabButtons.forEach((b) => {
      b.onclick = () => switchTab(b.dataset.tab);
    });

    function isInViewport(el) {
      const rect = el.getBoundingClientRect();
      const buffer = window.innerHeight * 0.5;
      return rect.bottom >= -buffer && rect.top <= window.innerHeight + buffer;
    }

    function setActiveMode(buttons, activeBtn) {
      buttons.forEach((b) => b.classList.remove('active'));
      activeBtn.classList.add('active');
    }

    function renderSectionList() {
      const sections = F.extractor.extractSections();
      sectionList.innerHTML = '';
      if (sections.length === 0) {
        sectionList.innerHTML = '<div style="font-size:11px;color:#94a3b8;padding:4px;">未识别到章节</div>';
        sectionList.style.display = 'block';
        return;
      }
      sections.forEach((s) => {
        const paraCount = s.elements.filter((e) => !/^H[1-6]$/.test(e.tagName)).length;
        const item = document.createElement('label');
        item.className = 'section-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.dataset.id = s.id;
        const span = document.createElement('span');
        span.innerText = `${s.title} (${paraCount}段)`;
        item.appendChild(cb);
        item.appendChild(span);
        sectionList.appendChild(item);
      });
      sectionList.style.display = 'block';
    }

    function getTargetParagraphs() {
      const mode = F.state.transMode;
      if (mode === 'all') {
        return F.extractor.getTranslatableParagraphs();
      }
      if (mode === 'sections') {
        const checkedIds = new Set(
          Array.from(sectionList.querySelectorAll('input:checked')).map((cb) => cb.dataset.id)
        );
        if (checkedIds.size === 0) return [];
        const sections = F.extractor.extractSections();
        const seen = new Set();
        const result = [];
        for (const s of sections) {
          if (!checkedIds.has(s.id)) continue;
          for (const el of s.elements) {
            if (!seen.has(el)) { seen.add(el); result.push(el); }
          }
        }
        return result;
      }
      // visible（默认，省钱推荐）：仅视口内且未翻译的段落
      return F.extractor.getTranslatableParagraphs().filter((el) => {
        if (el.dataset.feiyuTranslated === '1') return false;
        return isInViewport(el);
      });
    }

    const GUIDE_HINTS = {
      quick: '仅分析摘要，适合快速筛论文',
      full: '读取整篇正文与公式，适合深入拆解方法与实验'
    };
    function updateGuideHint() {
      if (guideHintEl) guideHintEl.innerText = GUIDE_HINTS[F.state.guideMode] || GUIDE_HINTS.quick;
    }
    updateGuideHint();

    guideQuickBtn.onclick = () => {
      F.state.guideMode = 'quick';
      setActiveMode([guideQuickBtn, guideFullBtn], guideQuickBtn);
      updateGuideHint();
    };
    guideFullBtn.onclick = () => {
      F.state.guideMode = 'full';
      setActiveMode([guideQuickBtn, guideFullBtn], guideFullBtn);
      updateGuideHint();
    };

    if (transVisibleBtn) {
      transVisibleBtn.onclick = () => {
        F.state.transMode = 'visible';
        setActiveMode([transVisibleBtn, transSectionsBtn, transAllBtn], transVisibleBtn);
        sectionList.style.display = 'none';
      };
      transSectionsBtn.onclick = () => {
        F.state.transMode = 'sections';
        setActiveMode([transVisibleBtn, transSectionsBtn, transAllBtn], transSectionsBtn);
        renderSectionList();
      };
      transAllBtn.onclick = () => {
        F.state.transMode = 'all';
        setActiveMode([transVisibleBtn, transSectionsBtn, transAllBtn], transAllBtn);
        sectionList.style.display = 'none';
      };
    }

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
        if (msg.visible) panelBody.style.display = '';
        sendResponse?.({ ok: true });
      }
      if (msg?.type === 'FEIYU_CONTEXT_ACTION') {
        const text = (msg.text || '').trim();
        if (text) {
          host.style.display = 'block';
          chrome.storage.local.set({ showPanel: true });
          panelBody.style.display = '';
          if (msg.action === 'translate') {
            runSelectionAction('translate', text, null);
          } else {
            runSelectionAction('explain', text, null);
          }
        }
        sendResponse?.({ ok: true });
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.showPanel) {
        const visible = changes.showPanel.newValue !== false;
        host.style.display = visible ? 'block' : 'none';
        if (visible) panelBody.style.display = '';
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

    let savedHostStyle = null;
    $('#btn-wide').onclick = () => {
      const on = cardEl.classList.toggle('sidebar');
      if (on) {
        savedHostStyle = {
          left: host.style.left,
          top: host.style.top,
          right: host.style.right
        };
        host.style.left = 'auto';
        host.style.right = '12px';
        host.style.top = '12px';
        host.style.height = 'calc(100vh - 24px)';
      } else {
        host.style.height = '';
        if (savedHostStyle) {
          host.style.left = savedHostStyle.left;
          host.style.top = savedHostStyle.top;
          host.style.right = savedHostStyle.right;
        } else {
          host.style.left = 'auto';
          host.style.top = '64px';
          host.style.right = '20px';
        }
      }
    };
    $('#btn-cfg').onclick = () => {
      cfgBox.style.display = cfgBox.style.display === 'none' || !cfgBox.style.display ? 'block' : 'none';
    };
    $('#btn-min').onclick = () => {
      panelBody.style.display = panelBody.style.display === 'none' ? '' : 'none';
    };
    $('#btn-hide').onclick = () => {
      host.style.display = 'none';
      chrome.storage.local.set({ showPanel: false });
    };
    $('#qa-close').onclick = () => {
      qaAnswer.innerHTML = '';
      qaContext.innerText = '';
      qaContext.style.display = 'none';
      qaInput.value = '';
      currentQaText = '';
      currentQaImageEl = null;
      currentQaImageDataUrl = null;
      qaImg.style.display = 'none';
      if (qaClearBtn) qaClearBtn.style.display = 'none';
    };

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
          setTabStatus(activeTab, `已保存 (${F.PROVIDERS[prov].label} · ${finalModel})`);
        }
      );
    };

    let dragging = false, ox = 0, oy = 0;
    $('#drag-header').addEventListener('mousedown', (e) => {
      if (cardEl.classList.contains('sidebar')) return; // 侧边栏模式不允许拖动
      dragging = true;
      const rect = host.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      if (cardEl.classList.contains('sidebar')) return;
      host.style.right = 'auto';
      host.style.left = `${Math.max(0, e.clientX - ox)}px`;
      host.style.top = `${Math.max(0, e.clientY - oy)}px`;
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    const toggleTransBtn = $('#btn-toggle-trans');
    if (toggleTransBtn) {
      toggleTransBtn.onclick = () => {
        F.state.translationsHidden = !F.state.translationsHidden;
        document.querySelectorAll('.feiyu-bilingual-box').forEach((box) => {
          box.style.display = F.state.translationsHidden ? 'none' : 'block';
        });
        setTabStatus('trans', F.state.translationsHidden ? '已隐藏译文' : '已显示译文');
      };
    }

    async function runSelectionAction(actionType, selText, imgEl, customQuestion = '', imgDataUrlOverride = null) {
      host.style.display = 'block';
      chrome.storage.local.set({ showPanel: true });
      panelBody.style.display = '';
      switchTab('qa');
      currentQaText = selText || '';
      currentQaImageEl = imgEl || null;

      // 图片预览：优先已粘贴的截图，其次传入的 DOM 图片
      if (imgDataUrlOverride) {
        qaImg.src = imgDataUrlOverride;
        qaImg.style.display = 'block';
      } else if (imgEl && imgEl.src) {
        qaImg.src = imgEl.src;
        qaImg.style.display = 'block';
      } else if (!currentQaImageDataUrl) {
        qaImg.style.display = 'none';
      }

      // 有选区文字才显示引用条；仅粘贴截图/图片时隐藏，给回答区腾空间
      if (currentQaText) {
        qaContext.innerText = currentQaText.slice(0, 260) + (currentQaText.length > 260 ? '...' : '');
        qaContext.style.display = 'block';
      } else {
        qaContext.innerText = '';
        qaContext.style.display = 'none';
      }

      if (actionType === 'focus') {
        qaAnswer.innerHTML = '';
        qaInput.focus();
        return;
      }

      qaAnswer.innerHTML = '<p>正在分析，请稍候...</p>';

      let imgDataUrl = null;
      if (imgDataUrlOverride) {
        imgDataUrl = imgDataUrlOverride;
      } else if (imgEl) {
        imgDataUrl = await F.app.imageToDataUrl(imgEl);
      }

      const sysPrompt = actionType === 'translate'
        ? '你是学术论文翻译专家。请将选中的英文论文内容精准翻译为流畅严谨的简体中文。' +
          '约束：1. 保留 Transformer、Attention 等通用英文术语；2. 行内公式使用简洁的 $...$ 格式；3. 仅输出译文。' +
          F.PROMPT_REFERENCES
        : '请直接切入核心内容作答，不要开场白、角色设定或套话。' +
          '严禁出现“作为你的科研导师”“掰开揉碎”“一句话大白话翻译”“导师拓展”等表述，也不要花哨标题或堆砌 emoji。' +
          '解释公式或段落时，用克制清晰的「核心含义 / 符号说明 / 实例演示」结构直接输出；' +
          '行内公式使用简洁的 $...$ 格式。';

      let userPrompt = '';
      if (actionType === 'translate') {
        userPrompt = `请翻译以下选中内容：\n\n${currentQaText}`;
      } else if (actionType === 'explain') {
        userPrompt =
          `请结合具体通俗的例子（举例说明），深入浅出地解释以下论文片段` +
          `${currentQaText ? `：\n\n${currentQaText}` : '中的图表流程与核心原理。'}`;
      } else {
        // 无选区但已缓存 PDF 按页文本时，附带缓存上下文供追问
        const cachedPdf = Array.isArray(F.state.pdfPages) ? F.state.pdfPages : [];
        const pdfCtx = !currentQaText && cachedPdf.length
          ? `\n\n（已缓存论文全文，截取前 3000 字供参考）：\n${cachedPdf.map((t, i) => `[Page ${i + 1}] ${t}`).join('\n').slice(0, 3000)}`
          : '';
        userPrompt =
          `针对以下论文内容${currentQaText ? `：\n「${currentQaText}」\n\n` : '（见附图或缓存全文）：\n\n'}` +
          `${pdfCtx}` +
          `请回答问题：${customQuestion}`;
      }

      try {
        const reply = await F.app.callAI(sysPrompt, userPrompt, imgDataUrl);
        qaAnswer.innerHTML = F.render.renderMarkdownToHTML(reply);
      } catch (err) {
        qaAnswer.innerHTML = `<p style="color:#dc2626;">解答失败：${err.message}</p>`;
      }
    }

    const DEFAULT_IMG_QUESTION = '请识别并详细解释图中的公式或图表内容（若为公式请给出直观含义与推导说明）';

    $('#qa-send').onclick = () => {
      let q = qaInput.value.trim();
      const hasImg = !!currentQaImageDataUrl;
      if (!q && !hasImg) return;
      if (!q && hasImg) q = DEFAULT_IMG_QUESTION;
      runSelectionAction('ask', currentQaText, currentQaImageEl, q, currentQaImageDataUrl);
    };
    qaInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#qa-send').click();
    });

    // ---- 粘贴截图识图：输入框与问答区域均监听 paste ----
    function handleQaPaste(e) {
      if (e.defaultPrevented) return;
      const dt = e.clipboardData;
      if (!dt || !dt.items) return;
      const imgItem = Array.from(dt.items).find((it) => it.type && it.type.startsWith('image/'));
      if (!imgItem) return; // 非图片：走默认文本粘贴
      e.preventDefault();
      const file = imgItem.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        if (typeof dataUrl !== 'string') return;
        currentQaImageDataUrl = dataUrl;
        qaImg.src = dataUrl;
        qaImg.style.display = 'block';
        if (qaClearBtn) qaClearBtn.style.display = 'block';
        // 无选区文字时隐藏引用条，直接给回答区腾空间
        if (!currentQaText) {
          qaContext.innerText = '';
          qaContext.style.display = 'none';
        }
        setTabStatus('qa', '已粘贴截图，可直接提问（如：解释图中公式）');
        qaInput.focus();
      };
      reader.readAsDataURL(file);
    }
    qaInput.addEventListener('paste', handleQaPaste);
    qaBox.addEventListener('paste', handleQaPaste);

    if (qaClearBtn) {
      qaClearBtn.onclick = () => {
        currentQaImageDataUrl = null;
        qaImg.src = '';
        qaImg.style.display = 'none';
        qaClearBtn.style.display = 'none';
        if (!currentQaText) {
          qaContext.innerText = '';
          qaContext.style.display = 'none';
        }
      };
    }

    let latestMarkdown = '';

    // PDF 页导读：用 pdf.js 提取文本后生成导读
    async function runPdfSummary() {
      const isQuick = F.state.guideMode === 'quick';
      setStatus(isQuick ? '正在下载并解析 PDF（快速导读）...' : '正在下载并解析 PDF（全文导读）...');
      switchTab('summary');
      summaryBox.innerHTML = '<p>正在解析 PDF，请稍候...</p>';

      try {
        const fullText = await F.app.getPdfText(location.href, (i, total) => {
          setStatus(`正在解析 PDF 第 ${i}/${total} 页...`);
        });

        let bodyContent;
        if (isQuick) {
          const parts = fullText.split(/\n\[Page \d+\]\n/).filter((t) => t.trim());
          const head = parts.slice(0, 2).map((t, i) => `[Page ${i + 1}]\n${t}`).join('\n\n');
          const tailStart = Math.max(0, parts.length - 2);
          const tail = parts.slice(tailStart).map((t, i) => `[Page ${tailStart + i + 1}]\n${t}`).join('\n\n');
          bodyContent = `（快速导读：以下为论文开头与结尾部分）\n${head}\n\n……\n\n${tail}`;
        } else {
          bodyContent = fullText.slice(0, 36000);
        }

        const title = (document.title || 'PDF 论文').replace(/\.pdf$/i, '');
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
          '3. 行内数学符号请使用简洁规范的 $...$ 格式（避免复杂宏）。\n' +
          '4. ' + F.PROMPT_DENOISE;
        const userPrompt = `论文标题：${title}\n\nPDF 文本内容：\n${bodyContent}`;

        const reply = await F.app.callAI(sysPrompt, userPrompt);
        latestMarkdown = `# ${title}\n\n> 原文链接：${location.href}\n\n${reply}`;
        summaryBox.innerHTML = F.render.renderMarkdownToHTML(reply);
        copyMdBtn.style.display = 'block';
        setStatus('导读生成完成');
      } catch (err) {
        summaryBox.innerHTML = `<p style="color:#dc2626;">生成失败：${err.message}</p>`;
        setStatus(err.message, true);
      }
    }

    $('#btn-summary').onclick = async () => {
      if (isPdfPage) {
        await runPdfSummary();
        return;
      }

      const info = F.extractor.extractPaperInfo();
      const { arxivId, title, pureAuthors, authorsText, abstractText, codeRepos, journal, doi, year, source } = info;
      let fullBodyText = info.fullBodyText;

      if (!abstractText && !fullBodyText) {
        setStatus('未检测到论文正文：本页可能仅提供 PDF 全文，或内容尚未加载完成', true);
        return;
      }

      // 选「全文导读」且页面无 HTML 正文时，尝试用 PDF 兜底提取全文
      if (!fullBodyText && F.state.guideMode === 'full') {
        const pdfUrl = F.extractor.getPdfUrl();
        if (pdfUrl) {
          setStatus('未检测到 HTML 全文，正在通过 PDF 提取正文...');
          switchTab('summary');
          summaryBox.innerHTML = '<p>正在下载并解析 PDF，请稍候...</p>';
          try {
            fullBodyText = await F.app.getPdfText(pdfUrl, (i, total) => {
              setStatus(`正在解析 PDF 第 ${i}/${total} 页...`);
            });
          } catch (err) {
            fullBodyText = '';
          }
        }
      }

      const isAbstractOnly = !fullBodyText;
      const sections = F.extractor.extractSections();
      const isQuick = F.state.guideMode === 'quick' && !isAbstractOnly;

      const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(title)}`;
      const codeBannerHtml =
        codeRepos.length > 0
          ? `<div class="code-banner"><span>开源代码</span><a href="${codeRepos[0]}" target="_blank" rel="noopener noreferrer">${codeRepos[0].replace(/^https?:\/\//, '')}</a></div>`
          : `<div class="code-banner none"><span>无代码链接</span><a href="${googleSearchUrl}" target="_blank" rel="noopener noreferrer">Google 搜索论文</a></div>`;

      let bodyContent;
      if (isQuick) {
        const bodySections = sections.filter((s) => s.id !== 'abstract');
        const toc = bodySections.map((s) => s.title).filter(Boolean);
        // 优先取「结论/总结/结语」类章节，否则取最后一节
        const conclusion =
          bodySections.find((s) => /conclusion|concluding|summary|remarks/i.test(s.title)) ||
          bodySections[bodySections.length - 1];
        const conclusionBody = conclusion
          ? conclusion.elements.map((e) => F.extractor.getCleanText(e)).filter(Boolean).join('\n')
          : '';
        bodyContent =
          `章节目录：\n${toc.join('\n')}\n\n` +
          (conclusion ? `结论节（${conclusion.title}）正文：\n${conclusionBody}` : '');
      } else {
        bodyContent = fullBodyText;
      }

      setStatus(isQuick ? '正在快速导读（摘要+目录+结论）...' : isAbstractOnly ? '正在基于摘要生成导读（本页无 HTML 全文，全文见 PDF）...' : '正在生成导读...');
      switchTab('summary');
      summaryBox.innerHTML = `${codeBannerHtml}<p>${isQuick ? '快速导读进行中，请稍候...' : isAbstractOnly ? '本页仅提供摘要与 PDF，正在基于摘要分析，请稍候...' : '正在分析全文，请稍候...'}</p>`;

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
        '4. 行内数学符号请使用简洁规范的 $...$ 格式（避免复杂宏）。\n' +
        '5. ' + F.PROMPT_DENOISE;

      const repoHint = codeRepos.length > 0 ? codeRepos.join(' , ') : '无代码链接';
      const userPrompt =
        `论文标题：${title}\n` +
        `作者信息：${authorsText || '未提取到'}\n` +
        `代码链接：${repoHint}\n\n` +
        `摘要：\n${abstractText}\n\n` +
        (isQuick
          ? `（快速导读模式：请基于以下章节目录与结论节概述全文要点）\n${bodyContent}`
          : `${fullBodyText ? `论文全文内容：\n${fullBodyText}` : '（注：本页未提供 HTML 全文，仅有摘要，请基于摘要作答）'}`);

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
          readAt: Date.now(),
          journal,
          doi,
          year,
          source
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

    // 解析页码范围（如 "1-2"、"1,3,5"、"3"），返回有序页码数组
    function parsePageRange(str) {
      const pages = new Set();
      const parts = String(str || '').split(/[,，\s]+/).filter(Boolean);
      for (const part of parts) {
        const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
        if (m) {
          const a = parseInt(m[1], 10);
          const b = parseInt(m[2], 10);
          for (let p = Math.min(a, b); p <= Math.max(a, b); p++) pages.add(p);
        } else if (/^\d+$/.test(part)) {
          pages.add(parseInt(part, 10));
        }
      }
      return Array.from(pages).sort((a, b) => a - b);
    }

    // 将文本按段落切块，避免单次请求过长
    function splitTextChunks(text, size) {
      const paras = String(text || '').split(/\n+/).filter((s) => s.trim());
      const chunks = [];
      let cur = '';
      for (const p of paras) {
        if ((cur + p).length > size && cur) {
          chunks.push(cur.trim());
          cur = p;
        } else {
          cur = (cur ? cur + '\n' : '') + p;
        }
      }
      if (cur.trim()) chunks.push(cur.trim());
      return chunks.length ? chunks : [String(text || '').slice(0, size)];
    }

    // PDF 页：按页码在面板内分段翻译
    async function runPdfPageRangeTranslate() {
      const setStatus = (m, e) => setTabStatus('trans', m, e);
      const rangeStr = pdfRangeInput ? pdfRangeInput.value.trim() : '';
      const pages = parsePageRange(rangeStr);
      if (pages.length === 0) {
        setStatus('请输入页码范围，如 1-2 或 1,3,5', true);
        return;
      }

      translating = true;
      F.state.stopBatchFlag = false;
      transBtn.innerText = '停止翻译';
      switchTab('trans');
      pdfTransOut.innerHTML = '<p>正在提取指定页文本...</p>';

      try {
        // 先确保全文按页文本已缓存（一次解析，后续复用）
        const allPages = await F.app.getPdfPages(location.href, (i, total) => {
          setStatus(`正在解析 PDF 第 ${i}/${total} 页...`);
        });

        let outHtml = '';
        for (let i = 0; i < pages.length; i++) {
          if (F.state.stopBatchFlag) break;
          const page = pages[i];
          setStatus(`正在翻译第 ${page} 页（${i + 1}/${pages.length}）...`);
          // 第 page 页只取 allPages[page - 1]，逐页独立，绝不跨页合并
          const pageText = allPages[page - 1] || '';
          const chunks = splitTextChunks(pageText, 8000);

          // 每页渲染一个独立块，页码标签严格置于该页内容最顶部
          outHtml += `<div class="pdf-chunk"><div class="pdf-page-tag">第 ${page} 页</div>`;
          for (const chunk of chunks) {
            if (F.state.stopBatchFlag) break;
            const sysPrompt = '你是学术论文翻译专家。请将以下论文文本精准翻译为流畅严谨的简体中文，保留专有名词缩写，仅输出译文。' +
              F.PROMPT_DENOISE + F.PROMPT_REFERENCES;
            const translated = await F.app.callAI(sysPrompt, chunk);
            outHtml += F.render.renderMarkdownToHTML(translated);
          }
          outHtml += `</div>`;
        }
        pdfTransOut.innerHTML = outHtml || '<p>已停止</p>';
        setStatus(F.state.stopBatchFlag ? '已暂停翻译' : '页码翻译完成');
      } catch (err) {
        pdfTransOut.innerHTML = `<p style="color:#dc2626;">翻译失败：${err.message}</p>`;
        setStatus(err.message, true);
      } finally {
        translating = false;
        transBtn.innerText = '开始翻译';
      }
    }

    const transBtn = $('#btn-translate');
    let translating = false;

    transBtn.onclick = async () => {
      const setStatus = (m, e) => setTabStatus('trans', m, e);
      if (translating) {
        F.state.stopBatchFlag = true;
        setStatus('正在停止...');
        return;
      }
      if (isPdfPage) {
        await runPdfPageRangeTranslate();
        return;
      }

      const targets = getTargetParagraphs();
      if (targets.length === 0) {
        const mode = F.state.transMode;
        setStatus(
          mode === 'sections'
            ? '请先勾选要翻译的章节'
            : mode === 'visible'
              ? '当前可见范围内没有未翻译段落'
              : '未找到可翻译段落',
          true
        );
        return;
      }

      translating = true;
      F.state.stopBatchFlag = false;
      transBtn.innerText = '停止翻译';

      const stopped = await F.app.translateBatch(targets, (i, total) => {
        setStatus(`正在翻译第 ${i + 1} / ${total} 段...`);
      });

      translating = false;
      transBtn.innerText = '开始翻译';
      setStatus(stopped ? '已暂停翻译' : '翻译完成');
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

    const figureSelector = isScienceDirect
      ? 'figure.figure'
      : 'figure.ltx_figure, figure.ltx_table';
    document.querySelectorAll(figureSelector).forEach((fig) => {
      const img = fig.querySelector('img');
      const captionEl = fig.querySelector('figcaption') || (isScienceDirect ? fig.querySelector('p') : null);
      const caption = F.extractor.getCleanText(captionEl);
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
