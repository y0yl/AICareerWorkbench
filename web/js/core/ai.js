// AI 客户端：JSON 任务与流式（SSE over fetch）任务。
import { store } from './store.js';
import { aiContext } from './model.js';
import { curriculumContext } from './plans.js';

let health = { ai: false, checked: false };

export async function checkHealth() {
  try {
    const res = await fetch('api/health');
    health = { ...(await res.json()), checked: true };
  } catch {
    health = { ai: false, checked: true, offline: true };
  }
  return health;
}
export const aiHealth = () => health;

function withContext(payload) {
  const s = store.state;
  if (!s) return payload;
  const { context, meta } = aiContext(s);
  const plan = curriculumContext(s);
  return { context: plan ? `${context}\n${plan}` : context, meta, ...payload };
}

export async function aiJSON(task, payload = {}) {
  let res;
  try {
    res = await fetch(`api/ai/${task}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withContext(payload)),
    });
  } catch {
    throw new Error('无法连接服务器，请确认后端已启动');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `AI 请求失败（${res.status}）`);
  return { data: data.data, mock: data.mock };
}

/**
 * 流式任务。onDelta(text 增量, 全文) 逐段回调；返回最终全文。
 * 传入 signal 可中止。
 */
export async function aiStream(task, payload = {}, { onDelta, onMeta, signal } = {}) {
  let res;
  try {
    res = await fetch(`api/ai/${task}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withContext(payload)),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('无法连接服务器，请确认后端已启动');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `AI 请求失败（${res.status}）`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      let obj = {};
      try { obj = JSON.parse(data || '{}'); } catch { /* ignore */ }
      if (event === 'delta' && obj.t) {
        full += obj.t;
        onDelta?.(obj.t, full);
      } else if (event === 'replace') {
        // 服务端输出过滤改写了已发送的内容：整体替换
        full = obj.t || '';
        onDelta?.('', full);
      } else if (event === 'meta') onMeta?.(obj);
      else if (event === 'error') throw new Error(obj.message || 'AI 服务异常');
    }
  }
  return full;
}
