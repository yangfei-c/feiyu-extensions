// 飞羽 · B站学习助手 - Content Script：B 站数据接口封装（元数据 / 字幕 / 弹幕 / 热评 / 播放器）
// 取数策略（依据实测校准）：
//   1) 元数据、播放器信息、热评：内容脚本在 www.bilibili.com 页面上下文直接 fetch(credentials:'include')。
//      ⚠️ 旧端点 /x/player/v2 会静默返回其它视频的字幕 URL（对 cid 零校验），已废弃；
//         播放器信息改用 B 站播放器同款 /x/player/wbi/v2?bvid=&cid=。
//   2) 字幕 JSON：位于 aisubtitle.hdslb.com，页面上下文会被 CORS 拦截，只能经 service-worker 代理，
//      且必须在拿到 subtitle_url 后立即下载（auth_key 有时效）。
(() => {
  'use strict';

  const F = (window.FeiyuBili = window.FeiyuBili || {});
  const { API } = F;

  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(res);
      });
    });
  }

  // —— 页面同源直连（api.bilibili.com 对 bilibili.com origin 放行 CORS） ——
  async function fetchJsonDirect(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`);
    const data = await res.json().catch(() => null);
    if (!data) throw new Error(`接口返回非 JSON（HTTP ${res.status}）`);
    return data;
  }

  async function fetchTextDirect(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`);
    return res.text();
  }

  // —— 字幕 JSON：跨域，只能走 service-worker 代理 ——
  async function fetchSubtitleJson(url) {
    const res = await sendMessage({
      type: 'FEIYU_BILI_FETCH',
      payload: { url, responseType: 'json' }
    });
    if (!res) throw new Error('后台无响应');
    if (!res.ok) throw new Error(res.error || `字幕下载失败（HTTP ${res.status || '?'}）`);
    return res.data;
  }

  // 秒 → MM:SS / HH:MM:SS
  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  // 从当前地址解析路线参数：bvid 一律取自 location.pathname，分P 取自 location.search（默认 1）。
  // 多集 / 合集场景下页面 __INITIAL_STATE__ 可能残留上一集数据，因此不允许从页面状态取 bvid / cid。
  function parseRoute() {
    const m = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
    if (!m) return null;
    const p = Number(new URLSearchParams(location.search).get('p')) || 1;
    return { bvid: m[1], p };
  }

  // 视频详情（权威数据源）：bvid 必须与请求一致；当前分P 的 cid 只从本次返回的 pages 中按 page === p 取。
  async function getVideoInfoFromView(bvid, p) {
    const data = await fetchJsonDirect(`${API.view}?bvid=${encodeURIComponent(bvid)}`);
    if (!data || data.code !== 0 || !data.data) {
      throw new Error((data && data.message) || '获取视频信息失败');
    }
    const d = data.data;

    if (d.bvid && d.bvid !== bvid) {
      throw new Error(`接口返回 bvid(${d.bvid}) 与当前地址(${bvid}) 不一致`);
    }

    const pages = Array.isArray(d.pages)
      ? d.pages.map((x) => ({ cid: x.cid, page: x.page, part: x.part, duration: x.duration }))
      : [];

    const wantP = Number(p) > 0 ? Number(p) : 1;
    const matched = pages.find((x) => x.page === wantP);
    // URL 的 p 超出该视频分P 范围（合集切换残留参数）时回落到第一集
    const pageNo = matched ? matched.page : pages.length ? pages[0].page : 1;
    const cid = Number(matched ? matched.cid : pages.length ? pages[0].cid : d.cid);
    const aid = Number(d.aid);

    // 硬校验：aid / cid 必须是有效正整数，杜绝 "undefined" / NaN 被拼进后续请求地址
    if (!Number.isFinite(aid) || aid <= 0) throw new Error('view 接口返回的 aid 无效');
    if (!Number.isFinite(cid) || cid <= 0) throw new Error('view 接口未返回有效的 cid');

    return {
      bvid: d.bvid || bvid,
      aid,
      cid,
      p: pageNo,
      title: d.title || '',
      upName: (d.owner && d.owner.name) || '',
      desc: String(d.desc || '').trim(),
      duration: Number(d.duration) || 0,
      pages,
      pageCount: pages.length,
      resolvedFromPage: Boolean(matched)
    };
  }

  // 字幕地址可能是 //aisubtitle.hdslb.com/... 形式，需补全协议
  function normalizeSubtitleUrl(u) {
    if (!u) return '';
    if (u.startsWith('//')) return 'https:' + u;
    if (u.startsWith('http://')) return 'https://' + u.slice(7);
    return u;
  }

  // 字幕筛选：优先 UP 主投稿中文字幕（zh-CN / zh-Hans 且 ai_type === 0），
  // 其次 AI 中文字幕（ai-zh），再兜底；只返回带有效 subtitle_url 的条目
  //（url 为空说明字幕仍在生成中，交给上层提示“正在生成中或暂无可用字幕”）。
  function pickSubtitle(subtitles) {
    if (!Array.isArray(subtitles) || !subtitles.length) return null;
    const hasUrl = (s) => Boolean(s && s.url);
    const uploadedZh = subtitles.find(
      (s) => /^(zh-CN|zh-Hans|zh-Hant)$/i.test(s.lan) && s.aiType === 0 && hasUrl(s)
    );
    if (uploadedZh) return uploadedZh;
    const aiZh = subtitles.find((s) => s.lan === 'ai-zh' && hasUrl(s));
    if (aiZh) return aiZh;
    const anyZh = subtitles.find((s) => /zh/i.test(s.lan) && hasUrl(s));
    if (anyZh) return anyZh;
    return subtitles.find(hasUrl) || null;
  }

  // 防串台锚点校验：ai-zh 字幕地址形如
  //   https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/<aid><cid><hash>?auth_key=...
  // 即文件名主体以「当前 aid + cid」开头。这里只认前缀型强证据，避免哈希中偶然出现的数字造成误判。
  function verifySubtitleUrl(url, { aid, cid, knownIds } = {}) {
    const u = String(url || '');
    if (!u) {
      return { ok: false, reason: 'empty', hitsAid: false, hitsCid: false, foreign: null, token: '' };
    }

    const m = u.match(/ai_subtitle\/(?:prod\/)?([0-9a-f]+)/i);
    const token = m ? m[1] : '';
    const startsWith = (id) => Boolean(token && id && token.startsWith(String(id)));
    const includes = (id) => Boolean(u && id && u.includes(String(id)));

    const hitsAid = startsWith(aid) || includes(aid);
    const hitsCid = startsWith(cid) || includes(cid);

    let foreign = null;
    if (token && Array.isArray(knownIds)) {
      for (const other of knownIds) {
        const n = Number(other);
        if (!n || n === Number(aid) || n === Number(cid)) continue;
        if (token.startsWith(String(n))) {
          foreign = n;
          break;
        }
      }
    }

    return {
      ok: !foreign,
      reason: foreign ? 'foreign' : 'ok',
      hitsAid,
      hitsCid,
      foreign,
      token: token.slice(0, 32)
    };
  }

  // 播放器信息（B 站播放器同款端点）：字幕列表 / need_login_subtitle / 官方章节 view_points。
  // 校验接口回显的 cid / aid，确保返回的字幕确实属于当前这一集。
  async function getPlayerInfo({ bvid, cid, aid }) {
    const reqCid = Number(cid);
    if (!Number.isFinite(reqCid) || reqCid <= 0) {
      throw new Error(`视频 cid 无效（${String(cid)}），已中止字幕请求`);
    }

    const url = `${API.playerWbi}?bvid=${encodeURIComponent(bvid)}&cid=${reqCid}`;
    const data = await fetchJsonDirect(url);
    if (!data || data.code !== 0 || !data.data) {
      throw new Error((data && data.message) || '获取播放器信息失败');
    }
    const d = data.data;
    const serverCid = Number(d.cid) || 0;
    const serverAid = Number(d.aid) || 0;

    if (serverCid && serverCid !== reqCid) {
      throw new Error(`播放器接口回显 cid(${serverCid}) 与请求(${reqCid}) 不一致，已中止`);
    }
    if (serverAid && aid && Number(aid) && serverAid !== Number(aid)) {
      throw new Error(`播放器接口回显 aid(${serverAid}) 与请求(${aid}) 不一致，已中止`);
    }
    if (d.bvid && bvid && d.bvid !== bvid) {
      throw new Error(`播放器接口回显 bvid(${d.bvid}) 与请求(${bvid}) 不一致，已中止`);
    }

    const sub = d.subtitle || {};
    const subtitles = (Array.isArray(sub.subtitles) ? sub.subtitles : []).map((x) => ({
      id: x.id,
      lan: x.lan || '',
      lanDoc: x.lan_doc || '',
      aiType: Number(x.ai_type),
      url: normalizeSubtitleUrl(x.subtitle_url || ''),
      rawUrl: x.subtitle_url || ''
    }));

    const viewPoints = (Array.isArray(d.view_points) ? d.view_points : [])
      .map((v) => ({
        from: Number(v.from) || 0,
        to: Number(v.to) || 0,
        content: String(v.content || '').trim()
      }))
      .filter((v) => v.content);

    return {
      needLoginSubtitle: d.need_login_subtitle === true,
      allowSubmit: sub.allow_submit === true,
      request: { bvid, aid: Number(aid) || serverAid, cid: reqCid },
      echoed: { aid: serverAid, cid: serverCid, pageNo: Number(d.page_no) || 0 },
      subtitles,
      viewPoints
    };
  }

  // 字幕 JSON：body: [{ from, to, content }]（走后台代理，规避 aisubtitle 的跨域限制）
  async function fetchSubtitleBody(subtitleUrl) {
    const data = await fetchSubtitleJson(normalizeSubtitleUrl(subtitleUrl));
    const body = Array.isArray(data && data.body) ? data.body : [];
    return body
      .map((x) => ({
        from: Number(x.from) || 0,
        to: Number(x.to) || 0,
        content: String(x.content || '').trim()
      }))
      .filter((x) => x.content);
  }

  // 弹幕 XML 兜底：<d p="秒,模式,字号,颜色,时间戳,池,用户hash,弹幕id">文本</d>
  async function fetchDanmaku(cid) {
    const xml = await fetchTextDirect(`${API.danmaku}?oid=${cid}`);
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const list = [];
    doc.querySelectorAll('d').forEach((node) => {
      const p = (node.getAttribute('p') || '').split(',');
      const seconds = Number(p[0]) || 0;
      const text = (node.textContent || '').trim();
      if (text) list.push({ seconds, text });
    });
    list.sort((a, b) => a.seconds - b.seconds);
    return list;
  }

  // 热评：mode=3 热门排序，oid 传 aid（在页面同源上下文直连，避免经后台放大风控命中率）
  async function fetchHotComments(aid) {
    const data = await fetchJsonDirect(`${API.reply}?oid=${aid}&type=1&mode=3&next=0&plat=1`);
    if (data.code === -352 || data.code === -412 || data.code === -403) {
      throw new Error(`热评请求被 B 站风控拦截（code ${data.code}），请稍后重试或先登录 B 站`);
    }
    if (data.code !== 0 || !data.data) {
      throw new Error((data && data.message) || '获取评论失败');
    }
    const d = data.data;
    const total = (d.cursor && d.cursor.all_count) || (d.page && d.page.count) || 0;
    const replies = Array.isArray(d.replies) ? d.replies : [];
    const list = replies
      .map((r) => ({
        rpid: r.rpid,
        like: Number(r.like) || 0,
        uname: (r.member && r.member.uname) || '匿名用户',
        message: String((r.content && r.content.message) || '').trim(),
        replyCount: Number(r.rcount) || 0,
        ctime: Number(r.ctime) || 0
      }))
      .filter((r) => r.message)
      .sort((a, b) => b.like - a.like);
    return { total, list };
  }

  // 播放器跳转：定位 bpx 播放器内的 video 元素
  function getVideoEl() {
    return document.querySelector('.bpx-player-video-wrap video') || document.querySelector('video');
  }

  function jumpTo(seconds) {
    const v = getVideoEl();
    const target = Math.max(0, Number(seconds) || 0);
    if (!v) return { ok: false, error: '未找到视频播放器' };
    try {
      v.currentTime = target;
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      return { ok: true, currentTime: v.currentTime };
    } catch (err) {
      return { ok: false, error: err?.message || '跳转失败' };
    }
  }

  // 字幕 → 带时间戳的纯文本（供 AI 阅读）
  function transcriptToText(subtitles, maxChars) {
    const lines = [];
    let used = 0;
    for (const s of subtitles) {
      const line = `[${formatTime(s.from)}] ${s.content}`;
      if (maxChars && used + line.length > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    }
    return lines.join('\n');
  }

  // 官方章节（view_points）→ 供 AI 分段参考
  function viewPointsToText(points, maxChars) {
    if (!Array.isArray(points) || !points.length) return '';
    const lines = [];
    let used = 0;
    for (const p of points) {
      const line = `- [${formatTime(p.from)}-${formatTime(p.to)}] ${p.content}`;
      if (maxChars && used + line.length > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    }
    return lines.join('\n');
  }

  // 弹幕 → 按时间聚合成"弹幕概览"文本（字幕不可用时的兜底上下文）
  function danmakuToText(danmaku, maxChars) {
    if (!danmaku.length) return '';
    const buckets = new Map();
    for (const d of danmaku) {
      const minute = Math.floor(d.seconds / 60) * 60;
      if (!buckets.has(minute)) buckets.set(minute, []);
      const arr = buckets.get(minute);
      if (arr.length < 6) arr.push(d.text);
    }
    const lines = [];
    let used = 0;
    for (const [minute, texts] of buckets) {
      const line = `[${formatTime(minute)}] ${texts.join(' / ')}`;
      if (maxChars && used + line.length > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    }
    return lines.join('\n');
  }

  F.api = {
    sendMessage,
    formatTime,
    parseRoute,
    getVideoInfoFromView,
    getPlayerInfo,
    pickSubtitle,
    verifySubtitleUrl,
    fetchSubtitleBody,
    fetchDanmaku,
    fetchHotComments,
    getVideoEl,
    jumpTo,
    transcriptToText,
    viewPointsToText,
    danmakuToText
  };
})();
