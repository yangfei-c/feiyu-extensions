// 飞羽 · B站学习助手 - 全局常量与配置
// 该文件需最先加载，供 popup 与 content 各模块共用。
window.FeiyuBili = window.FeiyuBili || {};

// 服务商与模型列表（popup 与 content 共用，消除重复定义）
window.FeiyuBili.PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    url: 'https://api.deepseek.com/chat/completions',
    models: ['deepseek-flash', 'deepseek-v4-pro']
  },
  openai: {
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4o-mini', 'gpt-4o']
  },
  custom: {
    label: '自定义接口',
    url: '',
    models: ['deepseek-flash', 'deepseek-v4-pro', 'gpt-4o-mini', 'gpt-4o']
  }
};

// 问题反馈中转地址（Cloudflare Worker）
window.FeiyuBili.FEEDBACK_ENDPOINT = 'https://feiyu-feedback.tyreelprice91.workers.dev';

// B 站接口地址（统一收拢，禁止在业务代码里散落硬编码）
window.FeiyuBili.API = {
  base: 'https://api.bilibili.com',
  // 播放器信息：字幕列表 / need_login_subtitle
  player: 'https://api.bilibili.com/x/player/v2',
  // 视频详情（元数据兜底）
  view: 'https://api.bilibili.com/x/web-interface/view',
  // 热评（mode=3 热门排序，oid 传 aid）
  reply: 'https://api.bilibili.com/x/v2/reply/main',
  // 弹幕 XML（未登录可用，字幕不可用时的文本兜底）
  danmaku: 'https://api.bilibili.com/x/v1/dm/list.so'
};

// AI 提示词模板（统一收拢，避免散落在业务代码里）
window.FeiyuBili.PROMPTS = {
  summary:
    '你是一名善于抓重点的学习助教，请基于视频字幕生成简体中文学习笔记。要求：\n' +
    '1. 严禁使用“一句话定位”“干货满满”“核弹级”等模板词汇，严禁空话套话。\n' +
    '2. 严格按以下 Markdown 结构输出：\n' +
    '## 核心结论\n（3-5 条，每条一句话）\n' +
    '## 分段大纲\n（按时间顺序拆分，每条必须以 [MM:SS] 时间戳开头，后接该段内容概述）\n' +
    '## 关键知识点\n（列出可复习的概念、公式或结论，每条一句话）\n' +
    '3. 时间戳必须使用 [MM:SS] 格式，且只能引用字幕中真实出现过的起止时间，不得编造。\n' +
    '4. 不要补充字幕中不存在的信息。',
  danmaku:
    '你是一名学习助教。由于该视频无可用字幕，只能基于弹幕概览生成学习笔记。要求：\n' +
    '1. 明确说明本笔记基于弹幕而非字幕，信息可能零散、不完整。\n' +
    '2. 严格按以下 Markdown 结构输出：\n' +
    '## 核心结论\n（2-4 条，能推断的结论）\n' +
    '## 分段大纲\n（每条以 [MM:SS] 开头；若某时间段无弹幕则写“弹幕稀少”）\n' +
    '## 关键知识点\n（弹幕中提及的知识点、术语或补充资料）\n' +
    '3. 不得把弹幕中的玩笑话当作事实结论。',
  comments:
    '你是内容运营，请基于 B 站视频的热门评论提炼要点。要求：\n' +
    '1. 严格按以下 Markdown 结构输出：\n' +
    '## 课代表笔记\n（把高赞评论中的干货、总结整理成要点，标注大概点赞量级）\n' +
    '## 勘误与争议\n（观众指出的错误、事实性纠正、争议点）\n' +
    '## 补充资料\n（评论中提到的书籍、链接、概念、延伸视频）\n' +
    '2. 某部分无内容时写“暂无”。不得编造评论中不存在的信息。',
  qa:
    '你是视频学习助手。请仅基于提供的视频字幕内容回答用户问题；' +
    '若字幕中确实没有相关信息，请明确回答“视频中未提及”，不要编造。' +
    '回答用简体中文，必要时用 [MM:SS] 标注时间戳。'
};

// 本地存储键
window.FeiyuBili.STORAGE_KEYS = {
  notes: 'biliNotes'
};

// 单条视频最多保留的笔记条数
window.FeiyuBili.MAX_NOTES = 200;

// 构建标记：用于在面板排查信息里确认当前运行的是哪一版代码（改动后请一并递增）
window.FeiyuBili.BUILD_TAG = 'v1.0.0+20261115c';
