// 飞羽 · B站学习助手 - Page Bridge（world: MAIN）
// 说明：内容脚本运行在隔离世界，感知不到页面内联脚本的写入时机与 SPA 路由变化。
// 本文件只在主世界做一个极轻量的「变化探测器」：当 __INITIAL_STATE__ 出现或地址变化时，
// 发一条 tick 通知隔离世界去重新解析。
//
// 重要：视频身份（bvid / p / cid）一律由隔离世界用「当前 URL + view 接口」确定。
// 这里不传递任何权威元数据 —— 多集 / 合集视频切换时 __INITIAL_STATE__ 会残留上一集数据，
// 若据此取 cid 会导致总结串台到别的视频。
(() => {
  'use strict';

  const TAG = 'feiyu-bili-bridge';
  let lastTick = '';

  function tick() {
    const stateReady = Boolean(window.__INITIAL_STATE__ && window.__INITIAL_STATE__.videoData);
    const sig = `${location.href}|${stateReady}`;
    if (sig === lastTick) return;
    lastTick = sig;
    window.postMessage({ source: TAG, type: 'tick', href: location.href }, '*');
  }

  // __INITIAL_STATE__ 由页面内联脚本写入，document_start 时可能还不存在，需要轮询等待
  tick();
  setInterval(tick, 600);
  window.addEventListener('popstate', tick);

  // 隔离世界主动拉取时强制重发一次
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data && e.data.source === TAG + '-req') {
      lastTick = '';
      tick();
    }
  });
})();
