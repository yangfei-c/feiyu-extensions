// 飞羽 · arXiv 论文助手 - 全局常量与配置
// 该文件需最先加载，供 popup 与 content 各模块共用。
window.FeiyuArxiv = window.FeiyuArxiv || {};

// 服务商与模型列表（popup 与 content 共用，消除重复定义）
window.FeiyuArxiv.PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    url: 'https://api.deepseek.com/chat/completions',
    models: ['deepseek-flash', 'deepseek-v4-pro']
  },
  openai: {
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4o-mini', 'gpt-4o', 'o3-mini']
  },
  custom: {
    label: '自定义接口',
    url: '',
    models: ['deepseek-flash', 'deepseek-v4-pro', 'gpt-4o-mini', 'gpt-4o']
  }
};

// 问题反馈中转地址（Cloudflare Worker，例如 https://feiyu-feedback.你的用户名.workers.dev）
window.FeiyuArxiv.FEEDBACK_ENDPOINT = 'https://feiyu-feedback.tyreelprice91.workers.dev';
