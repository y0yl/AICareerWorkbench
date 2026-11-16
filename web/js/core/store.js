// 状态管理：本地持久化（localStorage）+ 登录后与服务器同步。
const KEY = 'epoch.state.v1';
const AUTH_KEY = 'epoch.auth';
const PREF_KEY = 'epoch.prefs';
const BASE_KEY = 'epoch.syncBase'; // 上次与云端一致时的状态快照 + 云端版本号，用于三方合并

const safe = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 隐私模式等 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export const uid = (p = 'x') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function emptyState(profile = {}) {
  return {
    version: 1,
    profile: { name: '', school: '', grade: '大三', major: '人工智能', goal: 'job', hoursPerWeek: 12, interests: [], createdAt: Date.now(), ...profile },
    baseSkills: { math: 1, code: 1, ml: 1, dl: 1, llm: 1, cv: 0, rl: 0, data: 1, infra: 0, research: 0, product: 1, comm: 1 },
    target: null,
    curriculum: null, // { planId, since, skip: [], electives: [] }
    customRoles: [],
    entries: [],
    plan: null,
    runs: [],
    interviews: [],
    reviews: [],
    chat: [],
    updatedAt: Date.now(),
  };
}

let state = safe.get(KEY);
let auth = safe.get(AUTH_KEY);
const listeners = new Set();
let syncTimer = null;
const syncListeners = new Set();
const pushListeners = new Set(); // 每次成功上传云端后调用（发布日历 / 小组件订阅源）
let syncStatus = 'local';
// 沙盒：动画演示期间的状态只存在内存里，不写 localStorage、不同步云端；结束后原样恢复
let sandbox = null;

function setSync(s) { syncStatus = s; syncListeners.forEach((f) => f(s)); }

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `请求失败（${res.status}）`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function persist() {
  if (sandbox) return;
  if (state) safe.set(KEY, state);
  if (auth?.token && state) {
    clearTimeout(syncTimer);
    setSync('pending');
    syncTimer = setTimeout(pushRemote, 1200);
  }
}

// ---------- 多设备同步：版本号 + 三方合并 ----------
// 云端每次保存都有版本号（updatedAt）。上传时带上“我上次见到的版本”，若云端已被别的设备改过，
// 服务端返回 409 和云端最新状态；前端以上次同步的快照为共同祖先做三方合并后重试，两边的修改都保留。
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = (x) => (x && typeof x === 'object' ? x.id ?? (x.t != null && x.role ? `t${x.t}` : undefined) : undefined);
const keyed = (arr) => Array.isArray(arr) && arr.length > 0 && arr.every((x) => keyOf(x) != null);

export function merge3(base, local, remote) {
  if (sameJSON(local, remote)) return local;
  if (sameJSON(local, base)) return remote;
  if (sameJSON(remote, base)) return local;
  if (Array.isArray(local) && Array.isArray(remote) && (keyed(local) || !local.length) && (keyed(remote) || !remote.length)) {
    const B = new Map((Array.isArray(base) ? base : []).filter((x) => keyOf(x) != null).map((x) => [keyOf(x), x]));
    const L = new Map(local.map((x) => [keyOf(x), x]));
    const R = new Map(remote.map((x) => [keyOf(x), x]));
    const out = [];
    for (const [k, r] of R) {
      if (L.has(k)) out.push(merge3(B.get(k), L.get(k), r));
      else if (!B.has(k) || !sameJSON(B.get(k), r)) out.push(r); // 本地删了但云端又改过 → 保留
    }
    for (const [k, l] of L) {
      if (R.has(k)) continue;
      if (!B.has(k) || !sameJSON(B.get(k), l)) out.push(l); // 本地新增（或云端删了但本地改过）
    }
    return out;
  }
  const prim = (a) => Array.isArray(a) && a.every((x) => x == null || typeof x !== 'object');
  if (prim(local) && prim(remote)) {
    // 字符串 / 数字列表：并集，去掉任一边删除的
    const b = new Set(prim(base) ? base : []);
    const gone = new Set([...b].filter((x) => !local.includes(x) || !remote.includes(x)));
    return [...new Set([...remote, ...local])].filter((x) => !gone.has(x));
  }
  if (local && remote && typeof local === 'object' && typeof remote === 'object' && !Array.isArray(local) && !Array.isArray(remote)) {
    // 同一字段换成了不同的对象（比如一边结束了 Epoch、生成了新 batch）：取发生了变化的那一边
    if (local.id != null && remote.id != null && local.id !== remote.id) return local.id === base?.id ? remote : local;
    const out = {};
    for (const k of new Set([...Object.keys(remote), ...Object.keys(local)])) {
      const b = base && typeof base === 'object' ? base[k] : undefined;
      if (!(k in local)) { if (b === undefined || !sameJSON(b, remote[k])) out[k] = remote[k]; continue; }
      if (!(k in remote)) { if (b === undefined || !sameJSON(b, local[k])) out[k] = local[k]; continue; }
      out[k] = merge3(b, local[k], remote[k]);
    }
    return out;
  }
  return local; // 标量两边都改了：以当前设备为准
}

const syncBase = {
  get() { return safe.get(BASE_KEY); },
  set(st, at) { safe.set(BASE_KEY, { at, user: auth?.username, state: st }); },
  clear() { safe.del(BASE_KEY); },
};
const strip = (st) => (st ? { ...st, updatedAt: 0 } : st);

/** 把云端状态与本地合并；返回合并结果（本地无修改时直接取云端）。 */
function reconcile(remote) {
  const b = syncBase.get();
  const base = b?.user === auth?.username ? b.state : null;
  if (!state || !base || sameJSON(strip(state), strip(base))) return { next: remote, merged: false };
  const next = merge3(strip(base), strip(state), strip(remote));
  next.updatedAt = Date.now();
  return { next, merged: !sameJSON(strip(next), strip(remote)) };
}

async function pushRemote(retry = 2) {
  if (!auth?.token || !state || sandbox) return;
  try {
    setSync('syncing');
    const b = syncBase.get();
    const snapshot = JSON.parse(JSON.stringify(state));
    const res = await api('api/state', { method: 'PUT', body: { state: snapshot, base: b?.user === auth.username ? b.at : undefined } });
    syncBase.set(snapshot, res.updatedAt);
    setSync('synced');
    pushListeners.forEach((f) => { try { f(snapshot); } catch { /* ignore */ } });
  } catch (e) {
    if (e.status === 401) { auth = null; safe.del(AUTH_KEY); }
    if (e.status === 409 && e.data?.state && retry > 0) {
      // 其他设备先改了：三方合并后再推一次
      const { next } = reconcile(e.data.state);
      syncBase.set(e.data.state, e.data.updatedAt);
      state = next;
      safe.set(KEY, state);
      store.emit('remote');
      return pushRemote(retry - 1);
    }
    setSync('error');
  }
}

export const store = {
  get state() { return state; },
  get auth() { return auth; },
  get syncStatus() { return syncStatus; },
  get sandboxed() { return !!sandbox; },

  /** 进入沙盒：保存当前状态，之后的修改都不落盘。next 为沙盒的初始状态。 */
  beginSandbox(next = null) {
    if (!sandbox) { clearTimeout(syncTimer); sandbox = { state }; }
    state = next;
    this.emit('sandbox');
  },
  /** 退出沙盒：恢复进入前的状态。 */
  endSandbox() {
    if (!sandbox) return;
    state = sandbox.state;
    sandbox = null;
    persist(); // 进入沙盒时取消的待同步，在这里补上
    this.emit('remote');
  },
  onSync(fn) { syncListeners.add(fn); return () => syncListeners.delete(fn); },
  onPushed(fn) { pushListeners.add(fn); return () => pushListeners.delete(fn); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(reason) { listeners.forEach((f) => f(reason)); },

  /** 修改状态：mutator 直接修改 draft。 */
  update(mutator, reason = 'update') {
    if (!state) return;
    mutator(state);
    state.updatedAt = Date.now();
    persist();
    this.emit(reason);
  },
  replace(next, reason = 'replace') {
    state = next;
    if (state) state.updatedAt = Date.now();
    persist();
    this.emit(reason);
  },
  clear() {
    if (sandbox) { state = null; this.emit('clear'); return; }
    state = null;
    safe.del(KEY);
    this.emit('clear');
  },

  prefs: {
    get(k, d) { return (safe.get(PREF_KEY) || {})[k] ?? d; },
    set(k, v) { const p = safe.get(PREF_KEY) || {}; p[k] = v; safe.set(PREF_KEY, p); },
  },

  api,

  async login(username, password, register = false) {
    const data = await api(register ? 'api/auth/register' : 'api/auth/login', { method: 'POST', body: { username, password } });
    auth = { token: data.token, username: data.username };
    safe.set(AUTH_KEY, auth);
    await this.pullRemote(true);
    return auth;
  },
  async logout() {
    try { await api('api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    auth = null;
    safe.del(AUTH_KEY);
    syncBase.clear();
    setSync('local');
    this.emit('auth');
  },
  /** 拉取云端状态：刚登录时以云端为准；之后云端有新版本就与本地三方合并（两台设备的修改都保留）。 */
  async pullRemote(afterLogin = false) {
    if (!auth?.token || sandbox) return;
    try {
      setSync('syncing');
      const data = await api('api/state');
      const b = syncBase.get();
      const known = b?.user === auth.username ? b.at : null;
      if (!data.state) {
        if (state) await pushRemote(); else setSync('synced');
      } else if (afterLogin || !state) {
        state = data.state;
        safe.set(KEY, state);
        syncBase.set(data.state, data.updatedAt);
        setSync('synced');
        this.emit('remote');
      } else if (data.updatedAt === known) {
        // 云端没变：本地有未上传的修改就推上去
        if (b && !sameJSON(strip(state), strip(b.state))) await pushRemote(); else setSync('synced');
      } else {
        const { next, merged } = reconcile(data.state);
        state = next;
        safe.set(KEY, state);
        syncBase.set(data.state, data.updatedAt);
        this.emit('remote');
        if (merged) await pushRemote(); else setSync('synced');
      }
      this.emit('auth');
    } catch (e) {
      if (e.status === 401) { auth = null; safe.del(AUTH_KEY); this.emit('auth'); }
      setSync('error');
    }
  },
};

// 切回页面 / 窗口重新获得焦点时拉一次：另一台设备上的修改及时合并进来
let lastPull = 0;
function pullSoon() {
  if (!auth?.token || sandbox || document.visibilityState !== 'visible' || Date.now() - lastPull < 5000) return;
  lastPull = Date.now();
  clearTimeout(syncTimer);
  store.pullRemote();
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', pullSoon);
  window.addEventListener('focus', pullSoon);
  window.addEventListener('online', pullSoon);
}
