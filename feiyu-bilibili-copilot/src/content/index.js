// 飞羽 · B站学习助手 - Content Script：主入口、状态管理、SPA 监听与 AI 调度
// 关键约定：视频身份（bvid）与分P（p）一律实时从当前地址解析，元数据一律以 view 接口为准。
// 多集 / 合集场景下页面 __INITIAL_STATE__ 会残留上一集数据，禁止用其决定当前字幕 / 评论归属。
(() => {
  'use strict';

  const F = (window.FeiyuBili = window.FeiyuBili || {});

  if (document.getElementById('feiyu-bili-host')) return;

  const state = {
    video: null,          // { bvid, aid, cid, p, title, upName, pages }
    routeKey: '',         // `${bvid}|${p}`：当前已确认的视频身份
    pending: null,        // 进行中的解析（防重复请求）
    refreshTimer: null,
    subtitles: null,      // 当前视频字幕缓存
    subtitlesFor: '',     // 字幕缓存归属：`bvid|p|cid`，杜绝跨视频复用
    transcript: '',       // 带时间戳的字幕文本
    danmakuText: '',      // 弹幕概览文本
    comments: null,       // { total, list }
    commentsFor: ''       // 评论缓存归属：`bvid|aid`
  };
  F.state = state;

  function callAI(systemPrompt, userPrompt) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['provider', 'apiUrl', 'model', 'apiKey'], (cfg) => {
        const apiKey = (cfg.apiKey || '').trim();
        const provider = cfg.provider || 'deepseek';
        const url = (cfg.apiUrl || F.PROVIDERS[provider]?.url || F.PROVIDERS.deepseek.url).trim();
        const model = (cfg.model || F.PROVIDERS[provider]?.models[0] || 'deepseek-flash').trim();

        if (!apiKey) {
          reject(new Error('请先点击右上角设置填写 API Key'));
          return;
        }
        if (!url) {
          reject(new Error('请填写有效的接口地址'));
          return;
        }

        chrome.runtime.sendMessage(
          { type: 'FEIYU_AI_REQUEST', payload: { url, apiKey, model, systemPrompt, userPrompt } },
          (res) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!res?.ok) {
              reject(new Error(res?.error || '请求失败'));
              return;
            }
            resolve(res.content);
          }
        );
      });
    });
  }

  // —— 视频身份解析 ——
  function clearVideoState() {
    state.video = null;
    state.subtitles = null;
    state.subtitlesFor = '';
    state.transcript = '';
    state.danmakuText = '';
    state.comments = null;
    state.commentsFor = '';
  }

  // 当前地址是否仍指向同一条视频的同一集（防止 SPA 切换后仍用旧数据）
  function routeMatches(v) {
    if (!v) return false;
    const route = F.api.parseRoute();
    return Boolean(route && route.bvid === v.bvid && route.p === v.p);
  }

  // 解析当前视频：每次都重新从 location 取 bvid / p，再用 view 接口拿权威元数据。
  // force=true 时忽略同 key 缓存，强制重新请求。
  async function resolveVideo({ force = false } = {}) {
    const route = F.api.parseRoute();
    if (!route) {
      F.panel.setStatus('当前不是视频播放页（未识别到 BV 号）', true);
      return null;
    }
    const key = `${route.bvid}|${route.p}`;

    if (!force && state.routeKey === key && state.video) return state.video;
    if (state.pending && state.pending.key === key) return state.pending.promise;

    const promise = (async () => {
      const isSwitch = Boolean(state.routeKey) && state.routeKey !== key;
      state.routeKey = key;

      if (isSwitch) {
        // 切换视频 / 分P：立即清空上一条视频的字幕、热评、问答与总结缓存
        clearVideoState();
        F.panel.resetForNewVideo();
      }
      F.panel.setStatus('正在读取视频信息...');

      let info;
      try {
        info = await F.api.getVideoInfoFromView(route.bvid, route.p);
      } catch (err) {
        if (state.routeKey === key) F.panel.setStatus(`获取视频信息失败：${err.message}`, true);
        return null;
      }

      // 竞态保护：请求期间路由已被切走，丢弃本次结果
      if (state.routeKey !== key) return null;

      // 数据完整性校验：aid / cid 缺失时绝不进入后续字幕 / 评论请求
      if (!info || !info.bvid || !info.aid || !info.cid) {
        F.panel.setStatus('视频信息不完整（aid / cid 缺失），已中止', true);
        return null;
      }

      state.video = info;
      F.panel.renderVideoInfo(info);
      F.panel.setStatus('已识别视频，可生成总结');
      prefetchSubtitles(info);
      return info;
    })();

    state.pending = { key, promise };
    try {
      return await promise;
    } finally {
      if (state.pending && state.pending.promise === promise) state.pending = null;
    }
  }

  function scheduleRefresh(delay = 250) {
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      resolveVideo();
    }, delay);
  }

  // —— 字幕：只使用明确传入（或当前已确认）的视频 cid ——
  function pickSubtitle(subtitles) {
    if (!subtitles.length) return null;
    return (
      subtitles.find((s) => /zh|cn|ai-zh/i.test(s.lan)) ||
      subtitles.find((s) => /中文/.test(s.lanDoc)) ||
      subtitles[0]
    );
  }

  // 汇总“实际请求参数 + 字幕来源”的排查信息，直接显示在面板「总结」Tab
  function buildDebugInfo(v, ret) {
    const meta = (ret && ret.meta) || {};
    const info = meta.info || {};
    const picked = meta.picked || {};
    const body = state.subtitles && state.subtitles.length ? state.subtitles : meta.body || [];
    const last = body.length ? body[body.length - 1] : null;
    const lines = [];

    lines.push(`构建=${F.BUILD_TAG || 'unknown'}`);
    lines.push(`bvid=${v.bvid}  p=${v.p}`);
    lines.push(`aid=${v.aid}  cid=${v.cid}`);    if (v.duration) lines.push(`视频时长=${F.api.formatTime(v.duration)}`);
    if (info.request) lines.push(`请求 player/v2: aid=${info.request.aid} cid=${info.request.cid}`);
    if (info.echoed) {
      lines.push(`接口回显: aid=${info.echoed.aid} cid=${info.echoed.cid} page=${info.echoed.pageNo}`);
    }
    if (picked.url) lines.push(`subtitle_url=${picked.url}`);
    if (body.length) {
      lines.push(`字幕=${body.length} 条 · 末条 ${last ? F.api.formatTime(last.to || last.from) : '-'}`);
      const first = body
        .slice(0, 2)
        .map((x) => `[${F.api.formatTime(x.from)}] ${x.content}`)
        .join(' ｜ ');
      if (first) lines.push(`前两句: ${first}`);
    } else {
      lines.push('字幕: 无（未登录或该视频没有 AI 字幕）');
    }
    if (ret && ret.reason) lines.push(`状态: ${ret.reason}`);
    return lines.join('\n');
  }

  async function ensureSubtitles(video) {
    const v = video || state.video;
    if (!v) return { ok: false, reason: 'novideo' };

    // 字幕缓存必须与「视频身份」绑定（bvid|p|cid），绝不跨视频复用
    const cacheKey = `${v.bvid}|${v.p}|${v.cid}`;
    if (state.subtitles && state.subtitles.length && state.subtitlesFor === cacheKey) {
      return { ok: true, cached: true };
    }
    // 请求前再次确认地址仍指向这一集
    if (!routeMatches(v)) return { ok: false, reason: 'stale' };

    const isStale = () => state.routeKey !== `${v.bvid}|${v.p}` || !routeMatches(v);

    F.panel.setStatus('正在获取字幕...');
    let info = await F.api.getPlayerInfo({ aid: v.aid, cid: v.cid, bvid: v.bvid });
    if (isStale()) return { ok: false, reason: 'stale' };

    // B 站侧偶尔会瞬时返回空字幕列表（实测同一 cid 会波动），非登录墙时重试一次
    if (!info.subtitles.length && !info.needLoginSubtitle) {
      await new Promise((r) => setTimeout(r, 400));
      if (isStale()) return { ok: false, reason: 'stale' };
      info = await F.api.getPlayerInfo({ aid: v.aid, cid: v.cid, bvid: v.bvid });
      if (isStale()) return { ok: false, reason: 'stale' };
    }

    const picked = pickSubtitle(info.subtitles);
    if (!picked) {
      F.panel.showLoginHint();
      return {
        ok: false,
        reason: info.needLoginSubtitle ? 'login' : 'none',
        meta: { info, body: [] }
      };
    }

    F.panel.hideLoginHint();
    const body = await F.api.fetchSubtitleBody(picked.url);
    if (isStale()) return { ok: false, reason: 'stale' };
    if (!body.length) return { ok: false, reason: 'none', meta: { info, picked, body } };

    const last = body[body.length - 1];
    const lastTime = Number(last.to) || Number(last.from) || 0;
    // 时长合理性校验：字幕末条时间明显超出视频时长，极可能取到了别的视频
    if (v.duration && lastTime > v.duration + 60) {
      return { ok: false, reason: 'mismatch', meta: { info, picked, body } };
    }

    state.subtitles = body;
    state.subtitlesFor = cacheKey;
    state.transcript = F.api.transcriptToText(body, 14000);
    F.panel.setQaContext(
      `字幕已就绪（${body.length} 条，语言：${picked.lanDoc || picked.lan || '未标注'}）`
    );
    return { ok: true, meta: { info, picked, body } };
  }

  async function prefetchSubtitles(video) {
    const v = video || state.video;
    if (!v) return;
    try {
      const ret = await ensureSubtitles(v);
      F.panel.renderDebug(buildDebugInfo(v, ret));
      if (ret.ok) {
        F.panel.setStatus('字幕已就绪，可生成总结');
      } else if (ret.reason === 'login') {
        F.panel.setStatus('未登录 B 站，无法读取 AI 字幕；可先用弹幕生成概览', true);
      } else if (ret.reason === 'none') {
        F.panel.setStatus('该视频暂无字幕，可尝试用弹幕生成概览', true);
      } else if (ret.reason === 'mismatch') {
        F.panel.setStatus('字幕时长与视频不匹配，已拒绝使用（疑似串台），请重试', true);
      }
    } catch (err) {
      F.panel.setStatus(`字幕获取失败：${err.message}`, true);
    }
  }

  // —— 笔记存储 ——
  function saveNote(note) {
    chrome.storage.local.get([F.STORAGE_KEYS.notes], (res) => {
      const list = Array.isArray(res[F.STORAGE_KEYS.notes]) ? res[F.STORAGE_KEYS.notes] : [];
      const filtered = list.filter((item) => !(item.bvid === note.bvid && item.p === note.p));
      filtered.unshift(note);
      chrome.storage.local.set({ [F.STORAGE_KEYS.notes]: filtered.slice(0, F.MAX_NOTES) });
    });
  }

  function buildNoteMarkdown(v, reply) {
    let partInfo = '';
    if (v.pages && v.pages.length > 1) {
      const part = (v.pages.find((x) => x.page === v.p) || {}).part || '';
      partInfo = `\n- 分P：P${v.p}（${part}）`;
    }
    const url = `https://www.bilibili.com/video/${v.bvid}/${v.p > 1 ? '?p=' + v.p : ''}`;
    return `# ${v.title}\n\n- 视频：${url}\n- UP主：${v.upName || '未知'}${partInfo}\n\n${reply}`;
  }

  // —— 功能：总结 ——
  async function generateSummary(opts = {}) {
    const v = await resolveVideo();
    if (!v) {
      F.panel.setStatus('未识别到视频，请稍后重试', true);
      return;
    }
    const startedKey = state.routeKey;

    F.panel.switchTab('summary');
    F.panel.renderSummary('<p>正在获取字幕并生成总结，请稍候...</p>', '');

    try {
      let contextText = '';
      let systemPrompt = F.PROMPTS.summary;

      if (opts.useDanmaku) {
        F.panel.setStatus('正在读取弹幕并生成概览...');
        const dm = await F.api.fetchDanmaku(v.cid);
        if (!dm.length) {
          F.panel.renderSummary('<p>该视频暂无可用的弹幕与字幕，无法生成内容概览。</p>', '');
          F.panel.setStatus('无可用素材（字幕与弹幕均为空）', true);
          return;
        }
        state.danmakuText = F.api.danmakuToText(dm, 10000);
        contextText = state.danmakuText;
        systemPrompt = F.PROMPTS.danmaku;
        F.panel.renderDebug(
          [
            `构建=${F.BUILD_TAG || 'unknown'}`,
            `bvid=${v.bvid}  p=${v.p}`,
            `aid=${v.aid}  cid=${v.cid}`,
            `视频时长=${v.duration ? F.api.formatTime(v.duration) : '未知'}`,
            `弹幕=${dm.length} 条（按分钟聚合，未使用字幕）`
          ].join('\n')
        );
      } else {
        const sub = await ensureSubtitles(v);
        F.panel.renderDebug(buildDebugInfo(v, sub));
        if (!sub.ok) {
          if (sub.reason === 'stale') return; // 期间已切换视频，丢弃本次结果
          if (sub.reason === 'mismatch') {
            F.panel.renderSummary(
              '<p>检测到字幕与当前视频时长不匹配（疑似取到了别的视频），已拒绝使用。请刷新页面后重试。</p>',
              ''
            );
            F.panel.setStatus('字幕与视频不匹配，已中止生成', true);
            return;
          }
          F.panel.renderSummary(
            `<p>无法读取字幕${sub.reason === 'login' ? '（未登录 B 站）' : '（该视频无 AI 字幕）'}。</p>
             <p>可在下方点击「用弹幕生成概览」作为替代方案。</p>`,
            ''
          );
          F.panel.setStatus(
            sub.reason === 'login'
              ? '请先在 B 站右上角登录账号以读取 AI 字幕'
              : '该视频暂无字幕，可尝试用弹幕生成概览',
            true
          );
          return;
        }
        // 字幕缓存必须与当前视频身份一致，否则拒绝使用（防串台最后一道闸）
        const cacheKey = `${v.bvid}|${v.p}|${v.cid}`;
        if (state.subtitlesFor !== cacheKey || !state.transcript) {
          F.panel.setStatus('字幕缓存与当前视频不一致，请重试', true);
          return;
        }
        contextText = state.transcript;
      }

      F.panel.setStatus('AI 正在生成总结...');
      const partLabel =
        v.pages && v.pages.length > 1
          ? `P${v.p}（${(v.pages.find((x) => x.page === v.p) || {}).part || ''}）`
          : '单 P';
      const userPrompt =
        `视频标题：${v.title}\nUP主：${v.upName || '未知'}\n分P：${partLabel}\nBV号：${v.bvid}\n\n` +
        `以下为${opts.useDanmaku ? '弹幕概览' : '带时间戳的字幕'}：\n${contextText}`;

      const reply = await callAI(systemPrompt, userPrompt);
      if (startedKey !== state.routeKey) return; // 期间切换了视频，丢弃结果

      F.panel.renderSummary(F.render.renderMarkdownToHTML(reply), buildNoteMarkdown(v, reply));
      F.panel.setStatus('总结生成完成（已自动存入本地笔记）');
      saveNote({
        bvid: v.bvid,
        p: v.p,
        cid: v.cid,
        title: v.title,
        upName: v.upName || '',
        url: `https://www.bilibili.com/video/${v.bvid}/${v.p > 1 ? '?p=' + v.p : ''}`,
        summary: reply,
        source: opts.useDanmaku ? 'danmaku' : 'subtitle',
        at: Date.now()
      });
    } catch (err) {
      F.panel.renderSummary(`<p style="color:#dc2626;">生成失败：${F.render.escapeHtml(err.message)}</p>`, '');
      F.panel.setStatus(err.message, true);
    }
  }

  // —— 功能：热评 ——
  async function loadComments() {
    const v = await resolveVideo();
    if (!v) {
      F.panel.setStatus('未识别到视频，请稍后重试', true);
      return null;
    }
    F.panel.switchTab('reply');
    F.panel.setStatus('正在读取热门评论...');
    if (!routeMatches(v)) {
      F.panel.setStatus('页面已切换，请重新点击拉取', true);
      return null;
    }
    const startedKey = state.routeKey;
    try {
      const data = await F.api.fetchHotComments(v.aid);
      if (startedKey !== state.routeKey) return null; // 期间已切换视频
      state.comments = data;
      state.commentsFor = `${v.bvid}|${v.aid}`;
      F.panel.renderComments(data.list);
      if (data.list.length === 0) {
        F.panel.setStatus('未能获取到评论', true);
      } else if (data.total > data.list.length) {
        F.panel.setStatus(
          `已获取 ${data.list.length} 条（共 ${data.total} 条）；未登录 B 站时仅返回前几条热评`
        );
      } else {
        F.panel.setStatus(`已获取 ${data.list.length} 条热门评论`);
      }
      return data;
    } catch (err) {
      F.panel.setStatus(`获取评论失败：${err.message}`, true);
      return null;
    }
  }

  async function summarizeComments() {
    const v = await resolveVideo();
    if (!v) return;

    let data = state.commentsFor === `${v.bvid}|${v.aid}` ? state.comments : null;
    if (!data || !data.list.length) {
      data = await loadComments();
      if (!data || !data.list.length) return;
    }
    F.panel.switchTab('reply');
    F.panel.setStatus('AI 正在提炼热评...');
    F.panel.renderCommentSummary('<p>正在提炼，请稍候...</p>');
    const startedKey = state.routeKey;

    try {
      const text = data.list.map((c) => `[${c.like} 赞] ${c.uname}：${c.message}`).join('\n');
      const userPrompt = `视频标题：${v.title}\nBV号：${v.bvid}\n\n热门评论（按点赞降序）：\n${text}`;
      const reply = await callAI(F.PROMPTS.comments, userPrompt);
      if (startedKey !== state.routeKey) return; // 期间已切换视频
      F.panel.renderCommentSummary(F.render.renderMarkdownToHTML(reply));
      F.panel.setStatus('热评提炼完成');
    } catch (err) {
      F.panel.renderCommentSummary(
        `<p style="color:#dc2626;">提炼失败：${F.render.escapeHtml(err.message)}</p>`
      );
      F.panel.setStatus(err.message, true);
    }
  }

  // —— 功能：问答 ——
  async function askQuestion(rawQuestion) {
    const question = String(rawQuestion || '').trim();
    if (!question) {
      F.panel.setStatus('请输入问题', true);
      return;
    }
    const v = await resolveVideo();
    if (!v) {
      F.panel.setStatus('未识别到视频，请稍后重试', true);
      return;
    }
    F.panel.switchTab('qa');
    F.panel.renderQaAnswer('<p>正在思考，请稍候...</p>');

    try {
      const cacheKey = `${v.bvid}|${v.p}|${v.cid}`;
      let contextText = state.subtitlesFor === cacheKey ? state.transcript : '';
      if (!contextText) {
        const sub = await ensureSubtitles(v);
        if (sub.ok && state.subtitlesFor === cacheKey) {
          contextText = state.transcript;
        } else {
          if (sub.reason === 'stale') return; // 期间已切换视频
          const dm = await F.api.fetchDanmaku(v.cid);
          contextText = F.api.danmakuToText(dm, 8000);
          if (!contextText) {
            F.panel.renderQaAnswer('<p>该视频暂无可用字幕或弹幕，无法基于视频内容作答。</p>');
            F.panel.setStatus('无可用上下文（未登录或无字幕/弹幕）', true);
            return;
          }
          F.panel.setQaContext('字幕不可用，当前基于弹幕概览作答');
        }
      }

      const userPrompt =
        `视频标题：${v.title}\nBV号：${v.bvid}\n\n字幕上下文（带时间戳）：\n${contextText.slice(0, 9000)}\n\n` +
        `用户问题：${question}`;
      const startedKey = state.routeKey;
      const reply = await callAI(F.PROMPTS.qa, userPrompt);
      if (startedKey !== state.routeKey) return; // 期间已切换视频
      F.panel.renderQaAnswer(F.render.renderMarkdownToHTML(reply));
      F.panel.clearQaInput();
      F.panel.setStatus('回答完成');
    } catch (err) {
      F.panel.renderQaAnswer(
        `<p style="color:#dc2626;">回答失败：${F.render.escapeHtml(err.message)}</p>`
      );
      F.panel.setStatus(err.message, true);
    }
  }

  F.app = {
    callAI,
    resolveVideo,
    generateSummary,
    loadComments,
    summarizeComments,
    askQuestion,
    saveNote
  };

  // —— 启动 ——
  (async () => {
    await F.panel.mountPanel();
    resolveVideo();

    // 页内桥接仅作为「页面状态可能变化」的触发信号。
    // 元数据一律以 URL + view 接口为准，绝不使用页面 __INITIAL_STATE__ 里的 bvid / cid（多集易串台）。
    window.addEventListener('message', (e) => {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || d.source !== 'feiyu-bili-bridge') return;
      scheduleRefresh(200);
    });
    window.postMessage({ source: 'feiyu-bili-bridge-req' }, '*');

    // SPA 切视频 / 切分P：地址变化即立刻清空旧内容并重新解析
    let lastHref = location.href;
    setInterval(() => {
      if (location.href === lastHref) return;
      lastHref = location.href;

      const route = F.api.parseRoute();
      if (!route) return;
      const key = `${route.bvid}|${route.p}`;
      if (key !== state.routeKey) {
        clearVideoState();
        F.panel.resetForNewVideo();
        F.panel.setStatus('检测到视频切换，正在读取信息...');
      }
      scheduleRefresh(0);
    }, 600);
  })();
})();
