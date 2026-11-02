const rowsEl = document.getElementById('rows');
const loadBtn = document.getElementById('loadBtn');
const refreshBtn = document.getElementById('refreshBtn');
const playHeroBtn = document.getElementById('playHeroBtn');
const playerModal = document.getElementById('playerModal');
const playerFrame = document.getElementById('playerFrame');
const modalTitle = document.getElementById('modalTitle');
const closeModal = document.getElementById('closeModal');

const API = {
  videos: '../api/videos.php',
  comments: (videoId) => `../api/comments.php?videoId=${encodeURIComponent(videoId)}`,
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

function fmtCount(n) {
  if (n === null || n === undefined) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString();
}

async function loadComments(videoId, container, statusEl) {
  statusEl.textContent = 'Loading comments...';
  try {
    const data = await fetchJson(API.comments(videoId));
    const list = data?.data?.comments || [];
    if (!list.length) {
      statusEl.textContent = 'No comments yet.';
      return;
    }
    statusEl.textContent = '';
    container.innerHTML = '';
    list.forEach((c) => {
      const el = document.createElement('div');
      el.className = 'comment';
      el.innerHTML = `
        <div class="comment-author">${c.author_name}</div>
        <div class="comment-text">${c.text}</div>
        <div class="comment-meta">${fmtDate(c.published_at)} · ❤️ ${fmtCount(c.like_count)}</div>
      `;
      container.appendChild(el);
    });
  } catch (err) {
    statusEl.textContent = `Failed to load comments: ${err.message}`;
  }
}

function renderVideos(videos) {
  rowsEl.innerHTML = '';

  // Skeleton to show while loading can be added here; currently we render immediately.
  const row = document.createElement('div');
  row.className = 'row';

  const title = document.createElement('div');
  title.className = 'row-title';
  title.innerHTML = '🔥 Trending (sample feed)';
  row.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'video-grid';

  videos.forEach((v) => {
    const card = document.createElement('div');
    card.className = 'video-card';

    const thumb = document.createElement('div');
    thumb.className = 'video-thumb';
    thumb.innerHTML = `<img src="${v.thumbnail_url}" alt="${v.title}">`;
    thumb.addEventListener('click', () => openPlayer(v));

    const meta = document.createElement('div');
    meta.className = 'video-meta';
    meta.innerHTML = `
      <div class="video-title">${v.title}</div>
      <div class="video-channel">${v.channel_name}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'video-actions';
    actions.innerHTML = `
      <span class="pill">👁️ ${fmtCount(v.view_count)}</span>
      <span class="pill">❤️ ${fmtCount(v.like_count)}</span>
      <button class="btn-ghost-sm" data-comments="${v.youtube_id}">Comments</button>
      <button class="btn-ghost-sm" data-play="${v.youtube_id}">Play</button>
    `;

    const commentsWrap = document.createElement('div');
    commentsWrap.className = 'comments';
    commentsWrap.innerHTML = `
      <div class="comments-status">Click comments to load.</div>
      <div class="comments-list"></div>
    `;

    actions.querySelector('[data-comments]').addEventListener('click', () => {
      commentsWrap.classList.toggle('visible');
      const statusEl = commentsWrap.querySelector('.comments-status');
      const listEl = commentsWrap.querySelector('.comments-list');
      if (!commentsWrap.dataset.loaded) {
        commentsWrap.dataset.loaded = '1';
        loadComments(v.youtube_id, listEl, statusEl);
      }
    });

    actions.querySelector('[data-play]').addEventListener('click', () => openPlayer(v));

    card.appendChild(thumb);
    card.appendChild(meta);
    card.appendChild(actions);
    card.appendChild(commentsWrap);
    grid.appendChild(card);
  });

  row.appendChild(grid);
  rowsEl.appendChild(row);
}

async function load() {
  try {
    loadBtn.disabled = true;
    refreshBtn.disabled = true;
    const data = await fetchJson(API.videos);
    renderVideos(data.data.videos || []);
  } catch (err) {
    rowsEl.innerHTML = `<div class="card error">Failed to load feed: ${err.message}</div>`;
  } finally {
    loadBtn.disabled = false;
    refreshBtn.disabled = false;
  }
}

loadBtn.addEventListener('click', load);
refreshBtn.addEventListener('click', load);
playHeroBtn?.addEventListener('click', () => {
  openPlayer({
    youtube_id: 'dQw4w9WgXcQ',
    title: 'Hero Demo',
  });
});

closeModal?.addEventListener('click', closePlayer);
playerModal?.addEventListener('click', (e) => {
  if (e.target === playerModal) closePlayer();
});

// auto-load on entry
load();

function openPlayer(video) {
  const vid = video.youtube_id;
  const src = `https://www.youtube.com/embed/${vid}?autoplay=1`;
  playerFrame.src = src;
  modalTitle.textContent = video.title || 'Now Playing';
  playerModal.classList.add('visible');
}

function closePlayer() {
  playerFrame.src = '';
  playerModal.classList.remove('visible');
}

