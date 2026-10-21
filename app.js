const $ = s => document.querySelector(s);
const au = $('#au');
let db, tracks = [], curId = null, objUrl = null, shuffle = false, repeat = false, found = [];

/* ---------- Хранилище (IndexedDB) ---------- */
const idb = () => new Promise((ok, no) => {
  const r = indexedDB.open('nexamusic', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('tracks', { keyPath: 'id' });
  r.onsuccess = () => { db = r.result; ok(); };
  r.onerror = no;
});
const store = m => db.transaction('tracks', m).objectStore('tracks');
const wait = r => new Promise(ok => { r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); });
const loadLib = async () => { tracks = (await wait(store('readonly').getAll())) || []; tracks.sort((a, b) => b.added - a.added); };
const saveTrack = t => wait(store('readwrite').put(t));
const removeTrack = id => wait(store('readwrite').delete(id));

/* ---------- Утилиты ---------- */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = s => isFinite(s) ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '0:00';
let tm; const toast = t => { const m = $('#msg'); m.textContent = t; m.className = 'show'; clearTimeout(tm); tm = setTimeout(() => m.className = '', 2800); };

/* ---------- Вкладки ---------- */
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
  ['lib', 'find', 'set'].forEach(id => $('#' + id).hidden = id !== b.dataset.tab);
});

/* ---------- Библиотека ---------- */
function renderLib() {
  const q = $('#lq').value.trim().toLowerCase();
  const v = tracks.filter(t => !q || (t.title + ' ' + t.artist).toLowerCase().includes(q));
  $('#llist').innerHTML = !tracks.length
    ? '<li class="empty">Здесь пока пусто. Найдите музыку во вкладке «Поиск» или добавьте свои файлы.</li>'
    : !v.length ? '<li class="empty">Ничего не найдено.</li>'
    : v.map(t => `<li class="${t.id === curId ? 'cur' : ''}" data-id="${t.id}">
        <button data-a="play" aria-label="Играть">${t.id === curId && !au.paused ? '❚❚' : '▶'}</button>
        <div class="meta"><div class="t">${esc(t.title)}</div><div class="s">${esc(t.artist)} · ${(t.size / 1048576).toFixed(1)} МБ${t.lic ? ' · лицензия: ' + esc(t.lic) : ''}</div></div>
        <button data-a="del" aria-label="Удалить">✕</button></li>`).join('');
}
$('#lq').oninput = renderLib;
$('#llist').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  const id = b.closest('li').dataset.id;
  if (b.dataset.a === 'play') id === curId ? (au.paused ? au.play() : au.pause()) : playLib(id);
  if (b.dataset.a === 'del' && confirm('Удалить трек из приложения?')) {
    await removeTrack(id); if (id === curId) { au.pause(); au.removeAttribute('src'); curId = null; $('#now').textContent = 'Выберите трек'; }
    await loadLib(); renderLib();
  }
};
$('#addf').onclick = () => $('#file').click();
$('#file').onchange = async e => {
  for (const f of e.target.files) await saveTrack({ id: crypto.randomUUID(), title: f.name.replace(/\.[^.]+$/, ''), artist: 'Мой файл', lic: '', blob: f, size: f.size, added: Date.now() });
  e.target.value = ''; await loadLib(); renderLib(); toast('Добавлено в библиотеку');
};

/* ---------- Плеер ---------- */
function setSrc(src, title, artist) {
  if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
  au.src = src; $('#now').textContent = title + (artist ? ' — ' + artist : ''); au.play().catch(() => {});
  if ('mediaSession' in navigator) try { navigator.mediaSession.metadata = new MediaMetadata({ title, artist: artist || 'NexaMusic' }); } catch {}
}
function playLib(id) {
  const t = tracks.find(x => x.id === id); if (!t) return;
  curId = id; objUrl = URL.createObjectURL(t.blob);
  au.src = objUrl; $('#now').textContent = t.title + ' — ' + t.artist; au.play().catch(() => {});
  if ('mediaSession' in navigator) try { navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist }); } catch {}
  renderLib();
}
function step(d) {
  if (!tracks.length) return;
  const i = tracks.findIndex(t => t.id === curId);
  playLib(tracks[shuffle ? Math.floor(Math.random() * tracks.length) : (i + d + tracks.length) % tracks.length].id);
}
$('#play').onclick = () => curId || au.src ? (au.paused ? au.play() : au.pause()) : tracks[0] && playLib(tracks[0].id);
$('#next').onclick = () => step(1);
$('#prev').onclick = () => au.currentTime > 3 ? au.currentTime = 0 : step(-1);
$('#shuf').onclick = e => { shuffle = !shuffle; e.currentTarget.classList.toggle('on', shuffle); };
$('#rep').onclick = e => { repeat = !repeat; e.currentTarget.classList.toggle('on', repeat); };
$('#seek').oninput = e => { if (au.duration) au.currentTime = au.duration * e.target.value / 1000; };
au.ontimeupdate = () => { $('#cur').textContent = fmt(au.currentTime); if (au.duration) $('#seek').value = au.currentTime / au.duration * 1000; };
au.onloadedmetadata = () => $('#dur').textContent = fmt(au.duration);
au.onplay = () => { $('#play').textContent = '❚❚'; renderLib(); };
au.onpause = () => { $('#play').textContent = '▶'; renderLib(); };
au.onended = () => repeat ? (au.currentTime = 0, au.play()) : (curId ? step(1) : 0);
if ('mediaSession' in navigator) try { navigator.mediaSession.setActionHandler('nexttrack', () => step(1)); navigator.mediaSession.setActionHandler('previoustrack', () => step(-1)); } catch {}

/* ---------- Открытые источники ---------- */
async function searchIA(q) {
  // Простой запрос; лицензию фильтруем уже на нашей стороне
  const u = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q + ' AND mediatype:audio') +
    '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=licenseurl&rows=60&sort%5B%5D=downloads+desc&output=json';
  const r = await fetch(u);
  if (!r.ok) throw new Error('Internet Archive ответил ошибкой ' + r.status);
  const j = await r.json();
  const open = d => /creativecommons|publicdomain/i.test([].concat(d.licenseurl || '').join(' '));
  return j.response.docs.filter(open).slice(0, 25).map(d => ({
    ia: d.identifier, title: d.title, artist: [].concat(d.creator || 'Internet Archive')[0],
    lic: [].concat(d.licenseurl)[0].replace(/^https?:\/\/(www\.)?/, '')
  }));
}
async function iaTracks(item) {
  const m = await (await fetch('https://archive.org/metadata/' + item.ia)).json();
  const lic = (m.metadata?.licenseurl || '').replace(/^https?:\/\/(www\.)?/, '');
  return (m.files || []).filter(f => /mp3/i.test(f.format)).slice(0, 30).map(f => ({
    title: f.title || f.name.replace(/\.mp3$/i, ''), artist: item.artist, lic,
    url: 'https://archive.org/download/' + item.ia + '/' + encodeURIComponent(f.name)
  }));
}
async function searchJam(q) {
  const k = localStorage.getItem('jkey');
  if (!k) throw new Error('Добавьте Jamendo client_id во вкладке «Настройки»');
  const u = `https://api.jamendo.com/v3.0/tracks/?client_id=${encodeURIComponent(k)}&format=json&limit=20&search=${encodeURIComponent(q)}&audiodlformat=mp32`;
  const j = await (await fetch(u)).json();
  return (j.results || []).map(r => ({
    title: r.name, artist: r.artist_name, lic: (r.license_ccurl || '').replace(/^https?:\/\/(www\.)?/, ''),
    url: r.audiodownload_allowed ? r.audiodownload : r.audio, stream: r.audio
  }));
}
function renderFound() {
  $('#slist').innerHTML = found.length ? found.map((t, i) => `<li data-i="${i}">
    <div class="meta"><div class="t">${esc(t.title)}</div><div class="s">${esc(t.artist)}${t.lic ? ' · ' + esc(t.lic) : ''}</div></div>
    ${t.ia ? '<button data-a="open">Треки</button>' : '<button data-a="listen" aria-label="Слушать">▶</button><button data-a="dl" aria-label="Скачать">⬇</button>'}</li>`).join('')
    : '<li class="empty">Ничего не найдено.</li>';
}
$('#sf').onsubmit = async e => {
  e.preventDefault();
  const q = $('#sq').value.trim(); if (!q) return;
  toast('Ищу…');
  try { found = await ($('#src').value === 'ia' ? searchIA(q) : searchJam(q)); renderFound(); toast('Найдено: ' + found.length); }
  catch (err) { found = []; const m = err.message || 'Нет соединения с источником'; $('#slist').innerHTML = '<li class="empty">Ошибка поиска: ' + esc(m) + '</li>'; toast('Ошибка поиска'); }
};
$('#slist').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  const i = +b.closest('li').dataset.i, t = found[i];
  if (b.dataset.a === 'open') {
    toast('Загружаю список треков…');
    try { const list = await iaTracks(t); if (!list.length) return toast('В этой записи нет MP3'); found.splice(i, 1, ...list); renderFound(); }
    catch { toast('Не удалось открыть запись'); }
  }
  if (b.dataset.a === 'listen') { curId = null; setSrc(t.stream || t.url, t.title, t.artist); }
  if (b.dataset.a === 'dl') {
    b.disabled = true; toast('Скачиваю…');
    try {
      const r = await fetch(t.url); if (!r.ok) throw 0;
      const blob = await r.blob();
      await saveTrack({ id: crypto.randomUUID(), title: t.title, artist: t.artist, lic: t.lic, blob, size: blob.size, added: Date.now() });
      await loadLib(); renderLib(); toast('Сохранено в библиотеку');
    } catch { toast('Источник не разрешил скачивание. Попробуйте «Слушать» или другой трек'); }
    b.disabled = false;
  }
};
$('#slist').ondblclick = null;

/* ---------- Настройки и запуск ---------- */
$('#jkey').value = localStorage.getItem('jkey') || '';
$('#savek').onclick = () => { localStorage.setItem('jkey', $('#jkey').value.trim()); toast('Ключ сохранён'); };
async function showStorage() {
  if (navigator.storage?.estimate) { const { usage, quota } = await navigator.storage.estimate(); $('#stor').textContent = `Занято: ${(usage / 1048576).toFixed(0)} МБ из ${(quota / 1048576).toFixed(0)} МБ`; }
}
(async () => {
  await idb(); await loadLib(); renderLib();
  if (navigator.storage?.persist) navigator.storage.persist();
  showStorage();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
})();
