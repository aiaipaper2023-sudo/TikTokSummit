// Lightweight user behavior tracking SDK
(function() {
  const FLUSH_INTERVAL = 30000; // 30s
  const MAIN_ORIGIN = 'https://www.tiktoksummit.com';
  const isCrossOrigin = location.hostname !== 'www.tiktoksummit.com'
    && location.hostname !== 'tiktoksummit.com'
    && location.hostname.endsWith('.tiktoksummit.com');
  const API_ENDPOINT = isCrossOrigin
    ? MAIN_ORIGIN + '/api/analytics/track'
    : '/api/analytics/track';
  let queue = [];
  let sessionId = null;
  let pageEnterTime = null;
  let currentPage = null;

  function init() {
    sessionId = sessionStorage.getItem('tks_sid');
    if (!sessionId) {
      sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem('tks_sid', sessionId);
    }
    // Periodic flush
    setInterval(flush, FLUSH_INTERVAL);
    // Record page_leave + flush on page hide/unload
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        recordLeave();
        flush();
      }
    });
    window.addEventListener('pagehide', () => { recordLeave(); flush(); });
    window.addEventListener('beforeunload', () => { recordLeave(); flush(); });
  }

  function getUser() {
    try {
      const d = localStorage.getItem('tks_current');
      return d ? JSON.parse(d) : null;
    } catch { return null; }
  }

  function track(event, meta) {
    const user = getUser();
    queue.push({
      event,
      page: currentPage || location.pathname,
      user: user ? user.username : '_anon',
      role: user ? user.role : '_anon',
      sid: sessionId,
      ts: Date.now(),
      meta: meta || {}
    });
  }

  function flush() {
    if (!queue.length) return;
    const batch = queue.splice(0);
    const body = JSON.stringify({ events: batch });
    // Use text/plain for sendBeacon to avoid CORS preflight on subdomains
    if (navigator.sendBeacon) {
      navigator.sendBeacon(API_ENDPOINT, new Blob([body], { type: 'text/plain' }));
    } else {
      fetch(API_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true }).catch(() => {});
    }
  }

  // Record leave event for current page
  function recordLeave() {
    if (currentPage && pageEnterTime) {
      const duration = Math.round((Date.now() - pageEnterTime) / 1000);
      if (duration > 0) {
        track('page_leave', { duration });
      }
      pageEnterTime = null; // prevent duplicate leave events
    }
  }

  // Auto-track page view + time on page
  function trackPageView(pageName) {
    // Record leave event for previous page
    recordLeave();
    currentPage = pageName;
    pageEnterTime = Date.now();
    track('page_view', { referrer: document.referrer });
  }

  // Track clicks on elements with data-track attribute
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-track]');
    if (el) {
      track('click', { target: el.getAttribute('data-track'), text: (el.textContent || '').slice(0, 50).trim() });
    }
  });

  init();

  // Auto-detect page name if trackPageView isn't called within 500ms
  setTimeout(() => {
    if (!currentPage) {
      const pagePath = location.pathname.replace(/\/$/, '').split('/').pop() || 'home';
      let name = pagePath.replace('.html', '') || 'home';
      // Prefix with subdomain for cross-origin tracking
      if (isCrossOrigin) {
        const sub = location.hostname.replace('.tiktoksummit.com', '');
        name = sub + ':' + name;
      }
      trackPageView(name);
    }
  }, 500);

  // Expose globally
  window.TKS = { track, trackPageView, flush };
})();
