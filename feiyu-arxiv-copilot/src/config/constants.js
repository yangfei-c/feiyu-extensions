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

// 提示词约束：PDF 文本去噪（页眉页脚、版权声明、出版商网址等噪音）
window.FeiyuArxiv.PROMPT_DENOISE =
  '自动识别并剔除页眉、页脚、页码、ISSN/DOI 版权声明、出版商网址（如 Available online at、Published by Elsevier、© The Authors）以及重复出现的会议/期刊抬头，不要翻译也不要输出这些噪音内容。';

// 提示词约束：参考文献条目智能解读
window.FeiyuArxiv.PROMPT_REFERENCES =
  '若检测到待翻译内容属于参考文献条目（References / 学术引文列表），请不要仅直译论文标题，而是用简练的一段话说明每条文献：作者是谁、哪年发表在什么期刊或会议、主要研究了什么问题；如果属于你确切熟知的重要/经典文献，可简要补充其在该领域的学术地位或影响力（如不确定切勿编造影响因子或虚构细节）。';
