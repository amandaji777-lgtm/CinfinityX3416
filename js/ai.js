// 多供应商 AI 适配层。不写死某一家：OpenAI 兼容协议（含 DeepSeek/各种中转）与 Anthropic Messages。
// 浏览器直连第三方 API 可能撞 CORS 或该厂商禁止浏览器直连，这里只负责给出清楚的错误提示，
// 不会、也不能绕过浏览器的安全策略。

const AIError = class extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind; // 'auth' | 'not_found' | 'method' | 'rate_limit' | 'cors_or_network' | 'balance' | 'unknown'
  }
};

function explainHttpError(status, provider) {
  switch (status) {
    case 401:
      return new AIError('401 未授权：API Key 无效或已过期，请检查连接设置里的密钥。', 'auth');
    case 403:
      return new AIError('403 拒绝访问：密钥没有权限调用该模型/接口，或该服务商禁止浏览器直连（需要配置安全 Relay 后端）。', 'auth');
    case 404:
      return new AIError('404 未找到：请检查 Base URL / Endpoint 路径和模型名是否正确。', 'not_found');
    case 405:
      return new AIError('405 方法不允许：请求方式与该接口不匹配，请检查 Base URL 是否填成了网页地址而不是 API 地址。', 'method');
    case 429:
      return new AIError('429 请求过多：已触发限流或余额/配额不足，请稍后重试或检查账户余额。', 'rate_limit');
    default:
      if (status >= 500) return new AIError(`服务商返回 ${status} 错误，通常是对方服务端问题，可稍后重试。`, 'unknown');
      return new AIError(`请求失败，HTTP ${status}。`, 'unknown');
  }
}

function explainNetworkError(err) {
  if (err instanceof AIError) return err;
  const msg = String(err && err.message || err);
  return new AIError(
    `网络请求失败：可能是断网，也可能是该服务商不允许浏览器直接跨域调用（CORS）。若确认密钥和地址无误，通常需要配置一个你自己的安全后端/Serverless Relay 来转发请求。原始信息：${msg}`,
    'cors_or_network'
  );
}

async function* parseSSELines(reader) {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      yield line;
    }
  }
  if (buffer) yield buffer;
}

const Providers = {
  'openai-compatible': {
    label: 'OpenAI 兼容',
    async testConnection(conn, apiKey) {
      const url = joinUrl(conn.baseUrl, '/chat/completions');
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: buildOpenAIHeaders(conn, apiKey),
          body: JSON.stringify({
            model: conn.model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
            stream: false,
          }),
        });
        if (!res.ok) throw explainHttpError(res.status);
        return { ok: true };
      } catch (e) {
        throw explainNetworkError(e);
      }
    },
    async *streamChat(conn, apiKey, messages, signal) {
      const url = joinUrl(conn.baseUrl, '/chat/completions');
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: buildOpenAIHeaders(conn, apiKey),
          signal,
          body: JSON.stringify({
            model: conn.model,
            messages,
            temperature: conn.temperature ?? 0.8,
            top_p: conn.topP ?? 1,
            max_tokens: conn.maxTokens ?? 1024,
            stream: true,
          }),
        });
      } catch (e) {
        throw explainNetworkError(e);
      }
      if (!res.ok) throw explainHttpError(res.status);
      const reader = res.body.getReader();
      for await (const line of parseSSELines(reader)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch (_) { /* 忽略无法解析的心跳行 */ }
      }
    },
  },

  'gemini': {
    label: 'Gemini 原生',
    async testConnection(conn, apiKey) {
      const url = geminiUrl(conn, apiKey, 'generateContent');
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
            generationConfig: { maxOutputTokens: 1 },
          }),
        });
        if (!res.ok) throw explainHttpError(res.status);
        return { ok: true };
      } catch (e) {
        throw explainNetworkError(e);
      }
    },
    async *streamChat(conn, apiKey, messages, signal, systemPrompt) {
      const url = geminiUrl(conn, apiKey, 'streamGenerateContent') + '&alt=sse';
      const contents = messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            contents,
            systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
            generationConfig: {
              temperature: conn.temperature ?? 0.8,
              topP: conn.topP ?? 1,
              maxOutputTokens: conn.maxTokens ?? 1024,
            },
          }),
        });
      } catch (e) {
        throw explainNetworkError(e);
      }
      if (!res.ok) throw explainHttpError(res.status);
      const reader = res.body.getReader();
      for await (const line of parseSSELines(reader)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data) continue;
        try {
          const json = JSON.parse(data);
          const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
          if (text) yield text;
        } catch (_) { /* 忽略无法解析的行 */ }
      }
    },
  },

  // 受限的自定义协议映射：仅做声明式的字段/模板替换和响应路径提取，不执行用户提供的任意代码。
  'custom': {
    label: '自定义协议',
    async testConnection(conn, apiKey) {
      try {
        const { url, method, headers, body } = buildCustomRequest(conn, apiKey, [{ role: 'user', content: 'ping' }], '');
        const res = await fetch(url, { method, headers, body });
        if (!res.ok) throw explainHttpError(res.status);
        return { ok: true };
      } catch (e) {
        throw explainNetworkError(e);
      }
    },
    async *streamChat(conn, apiKey, messages, signal, systemPrompt) {
      const { url, method, headers, body } = buildCustomRequest(conn, apiKey, messages, systemPrompt);
      let res;
      try {
        res = await fetch(url, { method, headers, body, signal });
      } catch (e) {
        throw explainNetworkError(e);
      }
      if (!res.ok) throw explainHttpError(res.status);
      const format = conn.customStreamFormat || 'none';
      const path = conn.customResponseTextPath || '';
      if (format === 'none') {
        const json = await res.json();
        const text = getPath(json, path);
        if (text) yield String(text);
        return;
      }
      const reader = res.body.getReader();
      if (format === 'sse-json-path') {
        for await (const line of parseSSELines(reader)) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const text = getPath(JSON.parse(data), path);
            if (text) yield String(text);
          } catch (_) { /* 忽略无法解析的行 */ }
        }
      } else if (format === 'ndjson-json-path') {
        for await (const line of parseSSELines(reader)) {
          if (!line.trim()) continue;
          try {
            const text = getPath(JSON.parse(line), path);
            if (text) yield String(text);
          } catch (_) { /* 忽略无法解析的行 */ }
        }
      }
    },
  },

  'anthropic': {
    label: 'Anthropic',
    async testConnection(conn, apiKey) {
      const url = joinUrl(conn.baseUrl, '/v1/messages');
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: buildAnthropicHeaders(conn, apiKey),
          body: JSON.stringify({
            model: conn.model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
        });
        if (!res.ok) throw explainHttpError(res.status);
        return { ok: true };
      } catch (e) {
        throw explainNetworkError(e);
      }
    },
    async *streamChat(conn, apiKey, messages, signal, systemPrompt) {
      const url = joinUrl(conn.baseUrl, '/v1/messages');
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: buildAnthropicHeaders(conn, apiKey),
          signal,
          body: JSON.stringify({
            model: conn.model,
            max_tokens: conn.maxTokens ?? 1024,
            temperature: conn.temperature ?? 0.8,
            system: systemPrompt || undefined,
            messages,
            stream: true,
          }),
        });
      } catch (e) {
        throw explainNetworkError(e);
      }
      if (!res.ok) throw explainHttpError(res.status);
      const reader = res.body.getReader();
      for await (const line of parseSSELines(reader)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        try {
          const json = JSON.parse(data);
          if (json.type === 'content_block_delta' && json.delta?.text) {
            yield json.delta.text;
          }
          if (json.type === 'message_stop') return;
        } catch (_) { /* 忽略无法解析的行 */ }
      }
    },
  },
};

function joinUrl(base, path) {
  if (!base) throw new AIError('还没有填写 Base URL，请先在连接设置里配置。', 'not_found');
  const trimmedBase = base.replace(/\/+$/, '');
  if (trimmedBase.endsWith(path)) return trimmedBase;
  return trimmedBase + path;
}

function buildOpenAIHeaders(conn, apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  Object.assign(headers, conn.extraHeaders || {});
  return headers;
}

function geminiUrl(conn, apiKey, method) {
  const base = (conn.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  return `${base}/models/${encodeURIComponent(conn.model)}:${method}?key=${encodeURIComponent(apiKey || '')}`;
}

// 简单的 {{占位符}} 字符串替换，不做任何代码求值/执行。
function fillTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (key in vars ? vars[key] : ''));
}

function getPath(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function buildCustomRequest(conn, apiKey, messages, systemPrompt) {
  if (!conn.customUrl) throw new AIError('自定义协议还没有填写请求 URL。', 'not_found');
  const vars = {
    model: conn.model || '',
    apiKey: apiKey || '',
    system: JSON.stringify(systemPrompt || ''),
    messagesJSON: JSON.stringify(messages),
    temperature: String(conn.temperature ?? 0.8),
    maxTokens: String(conn.maxTokens ?? 1024),
  };
  const url = fillTemplate(conn.customUrl, vars);
  const headers = { 'Content-Type': 'application/json' };
  if (conn.customAuthHeaderName && conn.customAuthHeaderTemplate) {
    headers[conn.customAuthHeaderName] = fillTemplate(conn.customAuthHeaderTemplate, vars);
  }
  if (conn.customHeaders) {
    try { Object.assign(headers, JSON.parse(conn.customHeaders)); } catch (_) { /* 忽略非法 JSON */ }
  }
  const bodyText = conn.customBodyTemplate ? fillTemplate(conn.customBodyTemplate, vars) : vars.messagesJSON;
  return { url, method: conn.customMethod || 'POST', headers, body: bodyText };
}

function buildAnthropicHeaders(conn, apiKey) {
  const headers = {
    'Content-Type': 'application/json',
    'anthropic-version': conn.anthropicVersion || '2023-06-01',
    // Anthropic 默认拒绝浏览器直连；用户需要清楚这层风险后才勾选。
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (apiKey) headers['x-api-key'] = apiKey;
  Object.assign(headers, conn.extraHeaders || {});
  return headers;
}

const PROVIDER_PRESETS = [
  { id: 'openai', provider: 'openai-compatible', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'deepseek', provider: 'openai-compatible', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'xai', provider: 'openai-compatible', name: 'xAI Grok', baseUrl: 'https://api.x.ai/v1', model: 'grok-4' },
  { id: 'anthropic', provider: 'anthropic', name: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
  { id: 'gemini', provider: 'gemini', name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' },
];

const PROVIDER_LABELS = {
  'openai-compatible': 'OpenAI 兼容',
  'anthropic': 'Anthropic',
  'gemini': 'Gemini 原生',
  'custom': '自定义协议',
};
