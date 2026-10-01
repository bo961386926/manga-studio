// 主题初始化(防闪烁):auto=跟随系统,light/dark=手动指定
// 外链文件而非内联脚本：生产 CSP 为 script-src 'self'，内联脚本会被拦截。
(function () {
  function getSaved() {
    try { return localStorage.getItem('ai_manga_theme') || 'auto'; } catch (e) { return 'auto'; }
  }
  function applyTheme() {
    var saved = getSaved();
    var isLight;
    if (saved === 'light') isLight = true;
    else if (saved === 'dark') isLight = false;
    else isLight = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
    document.documentElement.classList.toggle('light', isLight);
    document.documentElement.setAttribute('data-theme', saved);
  }
  applyTheme();
  // auto 模式下实时跟随系统主题变化
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var onSystemChange = function () {
      if (getSaved() === 'auto') applyTheme();
    };
    if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
    else if (mq.addListener) mq.addListener(onSystemChange);
  }
})();
