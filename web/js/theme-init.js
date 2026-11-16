// 首帧前应用主题，避免闪烁（默认纸面主题，用户切换后记住选择）
try {
  var p = JSON.parse(localStorage.getItem('epoch.prefs') || '{}');
  var t = p.theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
  if (t === 'dark') document.querySelector('meta[name="theme-color"]').setAttribute('content', '#0a0c0f');
} catch (e) { /* ignore */ }
