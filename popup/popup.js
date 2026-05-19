const STORAGE_KEY = 'savedVideos';
const EXTRA_TOGGLE_KEY = 'extraEnabled';
const THEME_MODE_KEY = 'themeMode';
const SITE_THEME_KEY = 'siteTheme';
const DETAIL_MAX_LEN = 60;

let allVideos = [];
let currentQuery = '';
let extraEnabled = false;

// ── Utilities ──────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

// ── Highlighting ───────────────────────────────────────────

function highlightText(text, query) {
  if (!query || !text) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  return escaped.replace(regex, '<mark class="highlight">$1</mark>');
}

function truncateHighlight(text, query, maxLen = DETAIL_MAX_LEN) {
  if (!query || !text) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const escapedQuery = escapeRegex(query);
  const regex = new RegExp(`(${escapedQuery})`, 'gi');

  if (escaped.length <= maxLen) {
    return escaped.replace(regex, '<mark class="highlight">$1</mark>');
  }

  const match = regex.exec(escaped);
  if (!match) return escaped.substring(0, maxLen) + '...';

  const idx = match.index;
  const matchLen = match[0].length;
  const half = Math.floor((maxLen - matchLen) / 2);
  const start = Math.max(0, idx - half);
  const end = Math.min(escaped.length, idx + matchLen + half);

  let result = '';
  if (start > 0) result += '...';
  result += escaped.slice(start, idx);
  result += `<mark class="highlight">${escaped.slice(idx, idx + matchLen)}</mark>`;
  result += escaped.slice(idx + matchLen, end);
  if (end < escaped.length) result += '...';
  return result;
}

// ── Theme ──────────────────────────────────────────────────

function resolveTheme(themeMode, siteTheme) {
  if (themeMode === 'dark') return 'dark';
  if (themeMode === 'light') return 'light';
  return siteTheme === 'dark' ? 'dark' : 'light';
}

function applyTheme(mode) {
  const isDark = mode === 'dark';
  document.body.classList.toggle('theme-dark', isDark);
}

function updateTheme(themeMode, siteTheme) {
  applyTheme(resolveTheme(themeMode, siteTheme));
}

function handleThemeChange(themeMode) {
  chrome.storage.local.set({ [THEME_MODE_KEY]: themeMode });
  chrome.storage.local.get({ [SITE_THEME_KEY]: 'light' }, (result) => {
    updateTheme(themeMode, result[SITE_THEME_KEY]);
  });
}

// ── Extra Info Helpers ─────────────────────────────────────

function formatExtraDisplay(v) {
  if (!v.extra) return '';
  const parts = [];
  if (v.extra.desc) parts.push(`简介: ${v.extra.desc}`);
  if (v.extra.tname) parts.push(`分类: ${v.extra.tname}`);
  if (v.extra.tags && v.extra.tags.length) parts.push(`标签: ${v.extra.tags.join(', ')}`);
  return parts.join(' | ');
}

function buildExtraSearchText(v) {
  if (!v.extra) return '';
  const tags = v.extra.tags ? v.extra.tags.join(' ') : '';
  return [v.extra.desc, v.extra.tname, tags].filter(Boolean).join(' ');
}

function extraFetchCount() {
  return allVideos.filter(v => v.extra).length;
}

// ── Rendering ──────────────────────────────────────────────

function renderVideoItem(v) {
  const detailLine = currentQuery && extraEnabled && v.extra
    ? `<div class="video-detail">${truncateHighlight(formatExtraDisplay(v), currentQuery)}</div>`
    : '';

  return `
    <div class="video-item" data-url="${v.url}">
      <img class="video-cover" src="${v.cover || ''}" alt="${v.title}" loading="lazy"
        onerror="this.style.display='none'">
      <div class="video-info">
        <div class="video-title">${highlightText(v.title, currentQuery)}</div>
        <div class="video-meta">
          <span class="video-author">${highlightText(v.author || '未知', currentQuery)}</span>
          <span class="video-time">${formatTime(v.timestamp)}</span>
        </div>
        ${detailLine}
      </div>
    </div>
  `;
}

function render(videos) {
  const list = document.getElementById('videoList');
  const empty = document.getElementById('emptyState');

  if (!videos || videos.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = videos.map(renderVideoItem).join('');

  for (const el of list.querySelectorAll('.video-item')) {
    el.addEventListener('click', () => {
      const url = el.dataset.url;
      if (url) chrome.tabs.create({ url });
    });
  }
}

// ── Searching ──────────────────────────────────────────────

function videoMatchesQuery(v, q) {
  if (v.title && v.title.toLowerCase().includes(q)) return true;
  if (v.author && v.author.toLowerCase().includes(q)) return true;
  if (extraEnabled && v.extra) {
    return buildExtraSearchText(v).toLowerCase().includes(q);
  }
  return false;
}

function filterAndRender(query) {
  currentQuery = query;
  if (!query) {
    render(allVideos);
    return;
  }

  const q = query.toLowerCase();
  const filtered = allVideos.filter(v => videoMatchesQuery(v, q));
  render(filtered);
}

// ── Extra Info Fetching ────────────────────────────────────

async function fetchExtraForVideo(v) {
  if (v.extra) return;
  try {
    const [viewRes, tagRes] = await Promise.all([
      fetch(
        `https://api.bilibili.com/x/web-interface/view?bvid=${v.bvid}`,
        { headers: { Referer: 'https://www.bilibili.com/' } }
      ),
      fetch(
        `https://api.bilibili.com/x/tag/archive/tags?bvid=${v.bvid}`,
        { headers: { Referer: 'https://www.bilibili.com/' } }
      ),
    ]);

    const view = viewRes.ok ? await viewRes.json() : null;
    const tag = tagRes.ok ? await tagRes.json() : null;

    const desc = view?.data?.desc || '';
    const tname = view?.data?.tname || '';
    const tags = tag?.code === 0 && Array.isArray(tag?.data)
      ? tag.data.map(t => t.tag_name).filter(Boolean)
      : [];

    if (!desc && !tname && tags.length === 0) return;
    v.extra = { desc, tname, tags };
  } catch {
    /* network error, skip silently */
  }
}

async function batchFetchExtra() {
  const statusEl = document.getElementById('extraStatus');
  const pending = allVideos.filter(v => !v.extra);
  if (pending.length === 0) return;

  let done = 0;
  for (const v of pending) {
    await fetchExtraForVideo(v);
    done++;
    statusEl.textContent = `抓取中 ${done}/${pending.length}`;
    await new Promise(r => setTimeout(r, 200));
  }

  chrome.storage.local.set({ [STORAGE_KEY]: allVideos });
  updateStats();
  filterAndRender(currentQuery);
}

function updateStats() {
  const el = document.getElementById('extraStatus');
  if (!extraEnabled || allVideos.length === 0) {
    el.textContent = '';
    return;
  }
  el.textContent = `${extraFetchCount()}/${allVideos.length}`;
}

function toggleExtra(enable) {
  extraEnabled = enable;
  chrome.storage.local.set({ [EXTRA_TOGGLE_KEY]: enable });

  if (enable && allVideos.some(v => !v.extra)) {
    batchFetchExtra();
  }
  updateStats();
  filterAndRender(currentQuery);
}

// ── Initialization ─────────────────────────────────────────

function init() {
  chrome.storage.local.get(
    {
      [STORAGE_KEY]: [],
      [EXTRA_TOGGLE_KEY]: false,
      [THEME_MODE_KEY]: 'follow',
      [SITE_THEME_KEY]: 'light',
    },
    (result) => {
      allVideos = result[STORAGE_KEY];
      extraEnabled = result[EXTRA_TOGGLE_KEY];

      document.getElementById('extraToggle').checked = extraEnabled;

      const themeSelect = document.getElementById('themeSelect');
      themeSelect.value = result[THEME_MODE_KEY];
      updateTheme(result[THEME_MODE_KEY], result[SITE_THEME_KEY]);
      themeSelect.addEventListener('change', (e) => {
        handleThemeChange(e.target.value);
      });

      updateStats();
      render(allVideos);

      if (extraEnabled && allVideos.some(v => !v.extra)) {
        batchFetchExtra();
      }
    }
  );
}

// ── Event Binding ──────────────────────────────────────────

document.getElementById('clearBtn').addEventListener('click', () => {
  if (!confirm('确认清空所有缓存的视频？')) return;
  chrome.storage.local.set({ [STORAGE_KEY]: [] }, () => {
    allVideos = [];
    render([]);
    updateStats();
  });
});

document.getElementById('searchInput').addEventListener('input', (e) => {
  filterAndRender(e.target.value.trim());
});

document.getElementById('extraToggle').addEventListener('change', (e) => {
  toggleExtra(e.target.checked);
});

init();
