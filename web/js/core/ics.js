// 把本周 batch 导出为 iCalendar（.ics）：手机 / 电脑日历都能直接导入，每条任务带验收标准与提醒。
import * as B from './batch.js';

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const utcStamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const text = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545：每行不超过 75 个字节，续行以空格开头（按 UTF-8 字节折行，不切断多字节字符）。 */
function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const toMin = (hm) => { const [h, m] = String(hm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

/**
 * opts: { weekday: '19:30', weekend: '10:00', alarm: 15, includeQueue: true, includeDone: false }
 * 同一天的多个任务依次排开，中间留 10 分钟休息。
 */
export function batchToICS(state, opts = {}) {
  const { weekday = '19:30', weekend = '10:00', alarm = 15, includeQueue = true, includeDone = false } = opts;
  const b = state.batch;
  const items = [];
  // 已经过去的日子不再导出（逾期任务留在 Epoch 里处理）
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (b) for (const t of b.tasks) if ((includeDone || !t.done) && b.weekStart + t.day * B.DAY >= today.getTime()) items.push({ t, weekStart: b.weekStart });
  if (includeQueue) for (const q of state.batchQueue || []) items.push({ t: q, weekStart: q.weekStart });
  const cursor = new Map();
  const now = new Date();
  const events = [];
  for (const { t, weekStart } of items.sort((a, c) => a.weekStart + a.t.day * B.DAY - (c.weekStart + c.t.day * B.DAY))) {
    const day = new Date(weekStart + (t.day ?? 0) * B.DAY);
    const key = day.toDateString();
    const startMin = cursor.get(key) ?? toMin((t.day ?? 0) >= 5 ? weekend : weekday);
    const dur = Math.max(15, Math.round((+t.hours || 1) * 60));
    cursor.set(key, startMin + dur + 10);
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, startMin);
    const end = new Date(start.getTime() + dur * 60000);
    const src = B.SOURCES[t.src]?.name;
    const desc = [t.criteria && `验收：${t.criteria}`, t.resource && `资源：${t.resource}`, src && `来源：${src}`, '—— Epoch · AI 专业生涯训练台'].filter(Boolean).join('\n');
    events.push([
      'BEGIN:VEVENT',
      `UID:${t.id || `${weekStart}-${t.day}-${encodeURIComponent(t.title).slice(0, 40)}`}@epoch`,
      `DTSTAMP:${utcStamp(now)}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${text(`${t.done ? '✓ ' : ''}${t.title}`)}`,
      `DESCRIPTION:${text(desc)}`,
      'CATEGORIES:Epoch',
      ...(alarm > 0 && !t.done ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(t.title)}`, `TRIGGER:-PT${alarm}M`, 'END:VALARM'] : []),
      'END:VEVENT',
    ]);
  }
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Epoch//AI Career Workbench//ZH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${text('Epoch 本周训练')}`,
    ...events.flat(),
    'END:VCALENDAR',
  ];
  return { ics: lines.map(fold).join('\r\n') + '\r\n', count: events.length };
}
