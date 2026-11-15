// 飞羽 · B站学习助手 - Content Script：B 站数据接口封装（元数据 / 字幕 / 弹幕 / 热评 / 播放器）
(() => {
  'use strict';

  const F = (window.FeiyuBili = window.FeiyuBili || {});
  const { API } = F;

  // 与 background 通信（统一 Promise 化，便于 async/await）
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

  async function fetchJson(url) {
    const res = await sendMessage({ type: 'FEIYU_BILI_FETCH', payload: { url, responseType: 'json' } });
    if (!res) throw new Error('后台无响应');
    if (!res.ok) throw new Error(res.error || `请求失败（HTTP ${res.status || '?'}）`);
    return res.data;
  }

  async function fetchText(url) {
    const res = await sendMessage({ type: 'FEIYU_BILI_FETCH', payload: { url, responseType: 'text' } });
    if (!res) throw new Error('后台无响应');
    if (!res.ok) throw new Error(res.error || `请求失败（HTTP ${res.status || '?'}）`);
    return res.text || '';
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

  // 视频详情（权威数据源）：bvid 由调用方传入且必须与请求一致；
  // 当前分P 的 cid 只从本次返回的 pages 中按 page === p 取，确保 bvid 与 cid 严格同源同集。
  async function getVideoInfoFromView(bvid, p) {
    const data = await fetchJson(`${API.view}?bvid=${encodeURIComponent(bvid)}`);
    if (!data || data.code !== 0 || !data.data) {
      throw new Error((data && data.message) || '获取视频信息失败');
    }
    const d = data.data;

    // 严格校验：接口返回的 bvid 必须与当前地址解析出的 bvid 一致，否则拒绝使用
    if (d.bvid && d.bvid !== bvid) {
      throw new Error(`接口返回 bvid(${d.bvid}) 与当前地址(${bvid}) 不一致`);
    }

    const pages = Array.isArray(d.pages)
      ? d.pages.map((x) => ({ cid: x.cid, page: x.page, part: x.part, duration: x.duration }))
      : [];

    const wantP = Number(p) > 0 ? Number(p) : 1;
    const matched = pages.find((x) => x.page === wantP);
    // 若 URL 的 p 超出该视频分P 范围（合集切换的残留参数），回落到第一集
    const pageNo = matched ? matched.page : pages.length ? pages[0].page : 1;
    const cid = Number(matched ? matched.cid : pages.length ? pages[0].cid : d.cid);
    const aid = Number(d.aid);

    // 硬校验：aid / cid 必须是有效正整数，杜绝 "undefined" / NaN 被拼进后续请求地址
    if (!Number.isFinite(aid) || aid <= 0) {
      throw new Error('view 接口返回的 aid 无效');
    }
    if (!Number.isFinite(cid) || cid <= 0) {
      throw new Error('view 接口未返回有效的 cid');
    }

    return {
      bvid: d.bvid || bvid,
      aid,
      cid,
      p: pageNo,
      title: d.title || '',
      upName: (d.owner && d.owner.name) || '',
      duration: Number(d.duration) || 0,
      pages,
      pageCount: pages.length,
      resolvedFromPage: Boolean(matched)
    };
  }

  // 播放器信息：字幕列表与 need_login_subtitle。
  // 重要：/x/player/v2 对 cid 不做任何校验——传哪个 cid 就返回哪条视频的数据（实测），
  //   因此必须校验接口回显的 cid / aid，确保拿到的字幕确实属于当前这一集。
  async function getPlayerInfo({ aid, cid, bvid }) {
    const reqAid = Number(aid);
    const reqCid = Number(cid);

    // 硬校验：参数必须是有效正整数，否则直接中止（避免 cid=undefined / NaN 这类请求）
    if (!Number.isFinite(reqAid) || reqAid <= 0) {
      throw new Error(`视频 aid 无效（${String(aid)}），已中止字幕请求`);
    }
    if (!Number.isFinite(reqCid) || reqCid <= 0) {
      throw new Error(`视频 cid 无效（${String(cid)}），已中止字幕请求`);
    }

    const url = `${API.player}?aid=${reqAid}&cid=${reqCid}&bvid=${encodeURIComponent(bvid)}`;
    const data = await fetchJson(url);
    if (data.code !== 0 || !data.data) {
      throw new Error((data && data.message) || '获取播放器信息失败');
    }
    const d = data.data;
    const serverCid = Number(d.cid) || 0;
    const serverAid = Number(d.aid) || 0;

    if (serverCid && serverCid !== reqCid) {
      throw new Error(`字幕接口回显 cid(${serverCid}) 与请求(${reqCid}) 不一致，已中止`);
    }
    if (serverAid && reqAid && serverAid !== reqAid) {
      throw new Error(`字幕接口回显 aid(${serverAid}) 与请求(${reqAid}) 不一致，已中止`);
    }

    const sub = d.subtitle || {};
    return {
      needLoginSubtitle: d.need_login_subtitle === true,
      allowSubmit: sub.allow_submit === true,
      request: { bvid, aid: reqAid, cid: reqCid },
      echoed: { aid: serverAid, cid: serverCid, pageNo: Number(d.page_no) || 0 },
      subtitles: Array.isArray(sub.subtitles)
        ? sub.subtitles.map((x) => ({
            lan: x.lan || '',
            lanDoc: x.lan_doc || '',
            aiType: x.ai_type,
            url: normalizeSubtitleUrl(x.subtitle_url || '')
          })).filter((x) => x.url)
        : []
    };
  }

  // 字幕地址可能是 //aisubtitle.hdslb.com/... 形式，需补全协议
  function normalizeSubtitleUrl(u) {
    if (!u) return '';
    if (u.startsWith('//')) return 'https:' + u;
    if (u.startsWith('http://')) return 'https://' + u.slice(7);
    return u;
  }

  // 字幕 JSON：body: [{ from, to, content }]
  async function fetchSubtitleBody(subtitleUrl) {
    const data = await fetchJson(normalizeSubtitleUrl(subtitleUrl));
    const body = Array.isArray(data?.body) ? data.body : [];
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
    const xml = await fetchText(`${API.danmaku}?oid=${cid}`);
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const nodes = doc.querySelectorAll('d');
    const list = [];
    nodes.forEach((node) => {
      const p = (node.getAttribute('p') || '').split(',');
      const seconds = Number(p[0]) || 0;
      const text = (node.textContent || '').trim();
      if (text) list.push({ seconds, text });
    });
    list.sort((a, b) => a.seconds - b.seconds);
    return list;
  }

  // 热评：mode=3 热门排序，oid 传 aid
  async function fetchHotComments(aid) {
    const url = `${API.reply}?oid=${aid}&type=1&mode=3&next=0&plat=1`;
    const data = await fetchJson(url);
    if (data.code !== 0 || !data.data) {
      throw new Error(data.message || '获取评论失败');
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
    return (
      document.querySelector('.bpx-player-video-wrap video') ||
      document.querySelector('video')
    );
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
    fetchJson,
    formatTime,
    parseRoute,
    getVideoInfoFromView,
    getPlayerInfo,
    fetchSubtitleBody,
    fetchDanmaku,
    fetchHotComments,
    getVideoEl,
    jumpTo,
    transcriptToText,
    danmakuToText
  };
})();
