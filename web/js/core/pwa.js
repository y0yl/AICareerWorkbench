// PWA：注册 Service Worker（离线可打开），并接住浏览器的“安装到桌面”事件。
let deferred = null;
const listeners = new Set();
const emit = () => listeners.forEach((f) => f());

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const canInstall = () => !!deferred;
export const onInstallChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** 弹出浏览器的安装对话框；返回是否安装。 */
export async function install() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  emit();
  e.prompt();
  const { outcome } = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
  return outcome === 'accepted';
}

export function setupPWA({ prefetch } = {}) {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; emit(); });
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(() => {
      // 空闲时把各个页面模块拉一遍，经 Service Worker 缓存后离线也能切换页面
      const idle = window.requestIdleCallback || ((f) => setTimeout(f, 2500));
      idle(() => prefetch?.());
    }).catch(() => { /* 注册失败不影响使用 */ });
  });
}
