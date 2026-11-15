// 飞羽 · B站学习助手 - Content Script：悬浮面板 UI
(() => {
  'use strict';

  const F = (window.FeiyuBili = window.FeiyuBili || {});

  async function mountPanel() {
    const host = document.createElement('div');
    host.id = 'feiyu-bili-host';
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
          <div class="title-wrap">
            <div class="title">飞羽 · B站学习助手</div>
            <div class="title-video" id="hdr-video">正在读取视频信息...</div>
          </div>
          <div class="actions">
            <span id="btn-wide" title="全高侧边栏 / 紧凑浮窗">⤢</span>
            <span id="btn-cfg" title="模型设置">⚙</span>
            <span id="btn-min" title="折叠">—</span>
            <span id="btn-hide" title="隐藏面板（可在右上角扩展图标重新开启）">✕</span>
          </div>
        </div>
        <div class="tabs" id="tabs">
          <button class="tab active" data-tab="summary">总结</button>
          <button class="tab" data-tab="reply">热评</button>
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

          <div class="video-info" id="video-info">
            <div class="vi-title" id="vi-title">正在读取视频信息...</div>
            <div class="vi-meta" id="vi-meta"></div>
          </div>

          <div class="tab-panel active" id="tab-summary">
            <div class="status" id="status-summary">就绪</div>
            <div class="hint" id="sub-hint">
              请先在 B 站右上角登录账号以读取 AI 字幕（或点击下方按钮尝试用弹幕生成概览）。
              <div><button class="hint-btn" id="btn-danmaku">用弹幕生成概览</button></div>
            </div>
            <button class="btn-primary btn-block" id="btn-summary">生成总结</button>
            <div class="summary-box" id="summary-box"></div>
            <button class="btn-outline" id="btn-copy-md" style="display:none;">复制 Markdown 笔记</button>
            <div class="debug-box" id="debug-box" style="display:none;">
              <div class="debug-head" id="debug-toggle">排查信息（点击展开）</div>
              <pre id="debug-content" style="display:none;"></pre>
            </div>
            <div class="subs-row" id="subs-row" style="display:none;">
              <button class="btn-ghost" id="btn-toggle-subs" style="flex:1;">查看原文字幕</button>
              <button class="btn-ghost" id="btn-copy-subs" style="flex:none;">复制全部</button>
            </div>
            <div class="subs-list" id="subs-list" style="display:none;"></div>
          </div>

          <div class="tab-panel" id="tab-reply">
            <div class="status" id="status-reply"></div>
            <button class="btn-primary btn-block" id="btn-load-comments">拉取高赞评论</button>
            <div class="comment-list" id="comment-list"></div>
            <button class="btn-ghost btn-block" id="btn-summarize-comments">AI 提炼课代表笔记</button>
            <div class="summary-box" id="reply-summary"></div>
          </div>

          <div class="tab-panel" id="tab-qa">
            <div class="status" id="status-qa"></div>
            <div class="qa-box">
              <div class="qa-head">
                <strong>视频问答</strong>
                <span id="qa-clear" style="cursor:pointer;color:#94a3b8;">✕</span>
              </div>
              <div class="qa-context" id="qa-context">已读取字幕后将作为问答上下文</div>
              <div class="qa-paste-hint">在输入框内按 Ctrl + V 可粘贴视频截图，随问题一起发送</div>
              <div class="qa-img-wrap" id="qa-img-wrap" style="display:none;">
                <img id="qa-img" class="qa-img-preview" alt="截图预览" />
                <span id="qa-img-clear" class="qa-img-clear">移除截图</span>
              </div>
              <div class="qa-input-row">
                <input id="qa-input" type="text" placeholder="就视频内容提问，如：第 3 分钟讲了什么" />
                <button class="btn-primary" id="qa-send">提问</button>
              </div>
              <div class="qa-answer" id="qa-answer"></div>
            </div>
          </div>

          <div class="footer-note">支持 bilibili.com 视频页 · 需自行配置模型 API Key</div>
        </div>
      </div>
    `;

    const $ = (sel) => shadow.querySelector(sel);
    const cardEl = $('#main-card');
    const panelBody = $('#panel-body');
    const statusSummary = $('#status-summary');
    const statusReply = $('#status-reply');
    const statusQa = $('#status-qa');
    const cfgBox = $('#cfg-box');
    const subHint = $('#sub-hint');
    const hdrVideo = $('#hdr-video');
    const viTitle = $('#vi-title');
    const viMeta = $('#vi-meta');

    const summaryBox = $('#summary-box');
    const replySummary = $('#reply-summary');
    const commentList = $('#comment-list');
    const qaAnswer = $('#qa-answer');
    const qaInput = $('#qa-input');
    const qaContext = $('#qa-context');
    const qaImgWrap = $('#qa-img-wrap');
    const qaImg = $('#qa-img');
    const qaImgClear = $('#qa-img-clear');
    const copyMdBtn = $('#btn-copy-md');
    const debugBox = $('#debug-box');
    const debugContent = $('#debug-content');
    const debugToggle = $('#debug-toggle');
    const subsRow = $('#subs-row');
    const btnToggleSubs = $('#btn-toggle-subs');
    const btnCopySubs = $('#btn-copy-subs');
    const subsList = $('#subs-list');

    const providerSel = $('#sel-provider');
    const modelSel = $('#sel-model');
    const customWrap = $('#custom-url-wrap');
    const urlInp = $('#inp-url');
    const customModelInp = $('#inp-custom-model');
    const keyInp = $('#inp-key');

    const tabButtons = Array.from(shadow.querySelectorAll('.tab'));
    const panels = {
      summary: $('#tab-summary'),
      reply: $('#tab-reply'),
      qa: $('#tab-qa')
    };

    let latestMarkdown = '';
    let currentTab = 'summary';

    // 三个 Tab 各自维护状态栏，避免切换 Tab 时状态文字串台
    function statusElFor(tab) {
      if (tab === 'reply') return statusReply;
      if (tab === 'qa') return statusQa;
      return statusSummary;
    }

    const setStatus = (msg, isErr = false, tab) => {
      const el = statusElFor(tab || currentTab);
      el.className = isErr ? 'status err' : 'status';
      el.innerText = msg;
    };

    const setStatusFor = (tab, msg, isErr = false) => setStatus(msg, isErr, tab);

    function switchTab(name) {
      currentTab = name;
      tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
      Object.keys(panels).forEach((k) => panels[k].classList.toggle('active', k === name));
    }

    tabButtons.forEach((b) => {
      b.onclick = () => switchTab(b.dataset.tab);
    });

    // 时间戳点击跳转（事件委托，覆盖总结 / 热评提炼 / 问答三处渲染结果）
    [summaryBox, replySummary, qaAnswer].forEach((boxEl) => {
      boxEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.ts-btn');
        if (!btn) return;
        e.preventDefault();
        const sec = Number(btn.dataset.sec) || 0;
        const ret = F.api.jumpTo(sec);
        if (ret.ok) setStatus(`已跳转到 ${F.api.formatTime(sec)}`);
        else setStatus(ret.error || '跳转失败', true);
      });
    });

    // —— 原文字幕：懒渲染 + 时间戳跳转 + 一键复制 ——
    let currentSubtitles = [];
    let subsExpanded = false;

    function renderSubtitleRows() {
      if (!currentSubtitles.length) return;
      const frag = document.createDocumentFragment();
      for (const line of currentSubtitles) {
        const row = document.createElement('div');
        row.className = 'sub-item';
        const btn = document.createElement('button');
        btn.className = 'ts-btn';
        btn.dataset.sec = String(Math.max(0, Math.round(line.from)));
        btn.title = `跳到 ${F.api.formatTime(line.from)}`;
        btn.innerText = F.api.formatTime(line.from);
        const span = document.createElement('span');
        span.className = 'sub-text';
        span.innerText = line.content;
        row.appendChild(btn);
        row.appendChild(span);
        frag.appendChild(row);
      }
      subsList.innerHTML = '';
      subsList.appendChild(frag);
    }

    subsList.addEventListener('click', (e) => {
      const btn = e.target.closest('.ts-btn');
      if (!btn) return;
      e.preventDefault();
      const sec = Number(btn.dataset.sec) || 0;
      const ret = F.api.jumpTo(sec);
      setStatus(ret.ok ? `已跳转到 ${F.api.formatTime(sec)}` : ret.error || '跳转失败', !ret.ok);
    });

    btnToggleSubs.onclick = () => {
      if (!currentSubtitles.length) {
        setStatus('尚未加载字幕', true);
        return;
      }
      subsExpanded = !subsExpanded;
      if (subsExpanded && !subsList.childElementCount) renderSubtitleRows();
      subsList.style.display = subsExpanded ? 'block' : 'none';
      btnToggleSubs.innerText = subsExpanded
        ? `收起原文字幕（${currentSubtitles.length} 条）`
        : `查看原文字幕（${currentSubtitles.length} 条）`;
    };

    btnCopySubs.onclick = async () => {
      if (!currentSubtitles.length) {
        setStatus('尚未加载字幕', true);
        return;
      }
      const text = currentSubtitles
        .map((x) => `[${F.api.formatTime(x.from)}] ${x.content}`)
        .join('\n');
      try {
        await navigator.clipboard.writeText(text);
        setStatus(`已复制全部字幕（${currentSubtitles.length} 条）`);
      } catch {
        setStatus('复制失败，请检查剪贴板权限', true);
      }
    };

    // —— 问答：Ctrl + V 粘贴视频截图 ——
    let qaImageDataUrl = '';

    function setQaImage(dataUrl) {
      qaImageDataUrl = dataUrl || '';
      if (qaImageDataUrl) {
        qaImg.src = qaImageDataUrl;
        qaImgWrap.style.display = 'flex';
        setStatus('已粘贴截图，将随问题一起发送', false, 'qa');
      } else {
        qaImg.removeAttribute('src');
        qaImgWrap.style.display = 'none';
      }
    }

    qaImgClear.onclick = () => setQaImage('');

    cardEl.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (!item.type || !item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        const reader = new FileReader();
        reader.onload = () => setQaImage(String(reader.result || ''));
        reader.readAsDataURL(file);
        return;
      }
    });

    // —— 排查信息：默认折叠为一行小字，点击展开 ——
    let debugExpanded = false;
    debugToggle.onclick = () => {
      debugExpanded = !debugExpanded;
      debugContent.style.display = debugExpanded ? 'block' : 'none';
      debugToggle.innerText = debugExpanded ? '排查信息（点击收起）' : '排查信息（点击展开）';
    };

    // —— 配置区 ——
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

    function applyConfig(cfg) {
      const prov = cfg.provider || 'deepseek';
      providerSel.value = prov;
      populateModels(prov, cfg.model);
      urlInp.value = cfg.apiUrl || F.PROVIDERS[prov]?.url || '';
      if (prov === 'custom' && cfg.model && !F.PROVIDERS.custom.models.includes(cfg.model)) {
        customModelInp.value = cfg.model;
      }
      keyInp.value = cfg.apiKey || '';
    }

    chrome.storage.local.get(['showPanel', 'provider', 'apiUrl', 'model', 'apiKey'], (cfg) => {
      if (cfg.showPanel === false) host.style.display = 'none';
      applyConfig(cfg);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.showPanel) {
        host.style.display = changes.showPanel.newValue === false ? 'none' : 'block';
      }
      if (changes.provider || changes.apiUrl || changes.model || changes.apiKey) {
        chrome.storage.local.get(['provider', 'apiUrl', 'model', 'apiKey'], applyConfig);
      }
    });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'FEIYU_TOGGLE_PANEL') {
        host.style.display = msg.visible ? 'block' : 'none';
        sendResponse?.({ ok: true });
      }
    });

    $('#btn-save-cfg').onclick = async () => {
      const prov = providerSel.value;
      const finalUrl = prov === 'custom' ? urlInp.value.trim() : F.PROVIDERS[prov].url;
      const finalModel =
        prov === 'custom' && customModelInp.value.trim() ? customModelInp.value.trim() : modelSel.value;

      if (prov === 'custom' && finalUrl) {
        try {
          const origin = new URL(finalUrl).origin + '/*';
          await chrome.permissions.request({ origins: [origin] });
        } catch {}
      }

      chrome.storage.local.set(
        { provider: prov, apiUrl: finalUrl, model: finalModel, apiKey: keyInp.value.trim() },
        () => {
          cfgBox.style.display = 'none';
          setStatus(`已保存 (${F.PROVIDERS[prov].label} · ${finalModel})`);
        }
      );
    };

    // —— 顶栏操作 ——
    let savedHostStyle = null;
    $('#btn-wide').onclick = () => {
      const on = cardEl.classList.toggle('sidebar');
      if (on) {
        savedHostStyle = { left: host.style.left, top: host.style.top, right: host.style.right };
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
      cfgBox.style.display = cfgBox.style.display === 'block' ? 'none' : 'block';
    };
    $('#btn-min').onclick = () => {
      panelBody.style.display = panelBody.style.display === 'none' ? '' : 'none';
    };
    $('#btn-hide').onclick = () => {
      host.style.display = 'none';
      chrome.storage.local.set({ showPanel: false });
    };

    let dragging = false;
    let ox = 0;
    let oy = 0;
    $('#drag-header').addEventListener('mousedown', (e) => {
      if (cardEl.classList.contains('sidebar')) return;
      dragging = true;
      const rect = host.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging || cardEl.classList.contains('sidebar')) return;
      host.style.right = 'auto';
      host.style.left = `${Math.max(0, e.clientX - ox)}px`;
      host.style.top = `${Math.max(0, e.clientY - oy)}px`;
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    // —— 业务按钮 ——
    $('#btn-summary').onclick = () => F.app.generateSummary();
    $('#btn-danmaku').onclick = () => F.app.generateSummary({ useDanmaku: true });
    $('#btn-load-comments').onclick = () => F.app.loadComments();
    $('#btn-summarize-comments').onclick = () => F.app.summarizeComments();
    $('#qa-send').onclick = () => F.app.askQuestion(qaInput.value, qaImageDataUrl);
    qaInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') F.app.askQuestion(qaInput.value, qaImageDataUrl);
    });
    $('#qa-clear').onclick = () => {
      qaAnswer.innerHTML = '';
      qaInput.value = '';
      setQaImage('');
    };
    copyMdBtn.onclick = async () => {
      if (!latestMarkdown) return;
      await navigator.clipboard.writeText(latestMarkdown);
      setStatus('已复制 Markdown 笔记');
    };

    // —— 供 index.js 调用的渲染方法 ——
    const panel = {
      setStatus,
      setStatusFor,
      switchTab,
      showLoginHint() { subHint.classList.add('show'); },
      hideLoginHint() { subHint.classList.remove('show'); },

      renderVideoInfo(video) {
        if (!video || !video.bvid) {
          viTitle.innerText = '未识别到视频信息';
          viMeta.innerText = '请刷新页面后重试';
          hdrVideo.innerText = '未识别到视频';
          return;
        }
        const partLabel =
          video.pages && video.pages.length > 1 ? ` · P${video.p}/${video.pages.length}` : '';
        // 标题栏始终显示当前最新抓取到的标题与 bvid，避免误以为还在上一条视频
        hdrVideo.innerText = `${video.title || '(无标题)'}${partLabel} · ${video.bvid}`;
        hdrVideo.title = hdrVideo.innerText;

        viTitle.innerText = video.title || '(无标题)';
        const parts = [];
        if (video.upName) parts.push(`UP：${video.upName}`);
        if (video.pages && video.pages.length > 1) {
          const part = video.pages.find((x) => x.page === video.p) || video.pages[0];
          parts.push(`P${video.p}/${video.pages.length}${part ? ' · ' + part.part : ''}`);
        }
        parts.push(`BV：${video.bvid}`);
        viMeta.innerText = parts.join('　');
      },

      renderSummary(html, markdown) {
        summaryBox.innerHTML = html || '';
        latestMarkdown = markdown || '';
        copyMdBtn.style.display = markdown ? 'block' : 'none';
      },

      // 打印实际请求用到的 bvid / aid / cid / subtitle_url 与前两句字幕（默认折叠，不占版面）
      renderDebug(text) {
        if (!text) {
          debugContent.textContent = '';
          debugBox.style.display = 'none';
          return;
        }
        debugContent.textContent = text;
        debugBox.style.display = 'block';
        debugContent.style.display = debugExpanded ? 'block' : 'none';
        debugToggle.innerText = debugExpanded ? '排查信息（点击收起）' : '排查信息（点击展开）';
      },

      // 原始字幕（懒渲染，避免长视频一次性插入几千行 DOM）
      setSubtitles(list) {
        currentSubtitles = Array.isArray(list) ? list : [];
        subsExpanded = false;
        subsList.innerHTML = '';
        subsList.style.display = 'none';
        if (currentSubtitles.length) {
          subsRow.style.display = 'flex';
          btnToggleSubs.innerText = `查看原文字幕（${currentSubtitles.length} 条）`;
        } else {
          subsRow.style.display = 'none';
        }
      },

      renderComments(comments) {
        if (!comments || !comments.length) {
          commentList.innerHTML = '<div class="comment-empty">暂无可用评论</div>';
          return;
        }
        commentList.innerHTML = comments
          .map(
            (c) => `
            <div class="comment-item">
              <div class="ci-head">
                <span class="ci-user">${F.render.escapeHtml(c.uname)}</span>
                <span class="ci-like">赞 ${c.like}</span>
              </div>
              <div class="ci-text">${F.render.escapeHtml(c.message)}</div>
            </div>`
          )
          .join('');
      },

      renderCommentSummary(html) {
        replySummary.innerHTML = html || '';
      },

      renderQaAnswer(html) {
        qaAnswer.innerHTML = html || '';
      },

      setQaContext(text) {
        qaContext.innerText = text || '';
      },

      clearQaInput() {
        qaInput.value = '';
      },

      resetForNewVideo() {
        summaryBox.innerHTML = '';
        replySummary.innerHTML = '';
        commentList.innerHTML = '';
        qaAnswer.innerHTML = '';
        qaContext.innerText = '已读取字幕后将作为问答上下文';
        latestMarkdown = '';
        copyMdBtn.style.display = 'none';
        debugContent.textContent = '';
        debugBox.style.display = 'none';
        currentSubtitles = [];
        subsExpanded = false;
        subsList.innerHTML = '';
        subsList.style.display = 'none';
        subsRow.style.display = 'none';
        setQaImage('');
        qaInput.value = '';
        debugExpanded = false;
        subHint.classList.remove('show');
        statusSummary.className = 'status';
        statusReply.className = 'status';
        statusQa.className = 'status';
        statusSummary.innerText = '正在读取视频信息...';
        statusReply.innerText = '';
        statusQa.innerText = '';
        viTitle.innerText = '正在读取视频信息...';
        viMeta.innerText = '';
        hdrVideo.innerText = '正在读取视频信息...';
        hdrVideo.title = '';
      }
    };

    F.panel = panel;
    return panel;
  }

  F.panel = F.panel || {};
  F.panel.mountPanel = mountPanel;
})();
