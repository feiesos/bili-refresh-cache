(function () {
  const HOMEPAGE_PATH = '/';
  const MAX_ANCESTOR_DEPTH = 15;
  const MAX_STORED_VIDEOS = 200;
  const REFRESH_TEXT = '换一换';

  if (location.pathname && location.pathname !== HOMEPAGE_PATH) return;

  // ── Video Capture ────────────────────────────────────────

  let saveBusy = false;
  let pending = [];

  function scrapeVideoFromCard(wrap) {
    const linkEl = wrap.querySelector('.bili-video-card__image--link');
    const imgEl = wrap.querySelector('.bili-video-card__cover img');
    const titleEl = wrap.querySelector('.bili-video-card__info--tit a');
    const authorEl = wrap.querySelector('.bili-video-card__info--author');

    const url = linkEl ? linkEl.href : '';
    if (!url) return null;

    const bvid = url.match(/BV\w+/)?.[0] || '';
    if (!bvid) return null;

    return {
      url,
      bvid,
      title: titleEl ? titleEl.textContent.trim() : (imgEl ? imgEl.alt : ''),
      cover: imgEl ? imgEl.src : '',
      author: authorEl ? authorEl.textContent.trim() : '',
      timestamp: Date.now(),
    };
  }

  function scrapeVisibleVideos() {
    const cards = document.querySelectorAll('.bili-video-card__wrap');
    const items = [];

    for (const wrap of cards) {
      const video = scrapeVideoFromCard(wrap);
      if (video) items.push(video);
    }

    return items;
  }

  function tryFlush() {
    if (saveBusy) return;
    saveBusy = true;
    flush();
  }

  function flush() {
    const batch = pending.splice(0);
    if (batch.length === 0) {
      saveBusy = false;
      return;
    }

    chrome.storage.local.get({ savedVideos: [] }, (result) => {
      const saved = result.savedVideos;
      const existingBvids = new Set(saved.map(v => v.bvid));
      const deduped = batch.filter(v => v.bvid && !existingBvids.has(v.bvid));

      if (deduped.length > 0) {
        const merged = [...deduped, ...saved];
        if (merged.length > MAX_STORED_VIDEOS) merged.length = MAX_STORED_VIDEOS;
        chrome.storage.local.set({ savedVideos: merged }, () => {
          console.log(`[B站缓存] 已缓存 ${deduped.length} 个视频`);
        });
      }

      if (pending.length) flush(); else saveBusy = false;
    });
  }

  function saveVideos(newItems) {
    if (newItems.length === 0) return;
    pending.push(...newItems);
    tryFlush();
  }

  function isRefreshClick(target) {
    let el = target;
    for (let i = 0; i < MAX_ANCESTOR_DEPTH; i++) {
      if (!el || !el.textContent) return false;
      if (el.textContent.includes(REFRESH_TEXT)) return true;
      el = el.parentElement;
    }
    return false;
  }

  document.addEventListener('click', (e) => {
    if (isRefreshClick(e.target)) {
      saveVideos(scrapeVisibleVideos());
    }
  }, true);

  // ── Theme Detection ──────────────────────────────────────

  function detectSiteTheme() {
    const html = document.documentElement;
    const dataTheme = html.getAttribute('data-theme');
    if (dataTheme === 'dark' || dataTheme === 'light') return dataTheme;
    if (html.classList.contains('dark')) return 'dark';
    return 'light';
  }

  function storeSiteTheme() {
    chrome.storage.local.set({ siteTheme: detectSiteTheme() });
  }

  storeSiteTheme();

  const themeObserver = new MutationObserver(storeSiteTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'class'],
  });
})();
