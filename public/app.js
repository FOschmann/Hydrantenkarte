'use strict';
const $ = id => document.getElementById(id);
const VIENNA = [48.2082, 16.3738];
const fmt = new Intl.NumberFormat('de-AT');
const mobileQuery = matchMedia('(max-width: 760px)');

/* ---------- Karte ---------- */
const map = L.map('map', {zoomControl: false}).setView(VIENNA, 12);
L.control.zoom({position: 'topright'}).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  crossOrigin: true,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Hydranten: Stadt Wien'
}).addTo(map);
const clusters = L.markerClusterGroup({chunkedLoading: true, maxClusterRadius: 45, disableClusteringAtZoom: 18});
map.addLayer(clusters);
const icon = L.divIcon({className: 'hydrant', html: '<i></i>', iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -8]});

let hydrants = [], byId = new Map(), districts = [], districtLayer = null, activeDistrict = '';
let origin = null, originMarker = null, accuracyCircle = null, mode = null;
let reportPoint = null, reportMarker = null, rankToken = 0;

const status = text => { $('status').textContent = text; };
function toast(text) {
  const t = $('toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- Hilfsfunktionen ---------- */
function distance(a, b) {
  const rad = Math.PI / 180, dlat = (b.lat - a.lat) * rad, dlng = (b.lng - a.lng) * rad;
  const x = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}
const meters = d => d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1).replace('.', ',') + ' km';
const minutes = s => Math.max(1, Math.round(s / 60)) + ' min';
const navigation = (h, apple = false) => apple
  ? `https://maps.apple.com/?daddr=${h.lat},${h.lng}&dirflg=w`
  : `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}&travelmode=walking`;
function link(text, url) {
  const a = document.createElement('a');
  a.textContent = text; a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  return a;
}
function button(text, onClick, className = '') {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = text; b.className = className; b.onclick = onClick;
  return b;
}
const districtName = h => h.district ? `${h.district.nr}. ${h.district.name}` : 'Wien';
const shareUrl = h => `${location.origin}/?h=${encodeURIComponent(h.id)}`;

async function share(h) {
  const url = shareUrl(h);
  const data = {title: `Hydrant ${h.id}`, text: `Hydrant ${h.id} · ${districtName(h)}`, url};
  try {
    if (navigator.share) { await navigator.share(data); return; }
    await navigator.clipboard.writeText(url);
    toast('Link kopiert');
  } catch (err) {
    if (err?.name !== 'AbortError') prompt('Link zum Hydranten:', url);
  }
}

/* ---------- Mobiles Panel (Bottom Sheet) ---------- */
const panel = $('panel');
const SHEET_STATES = ['peek', 'half', 'full'];
function setSheet(state) {
  panel.dataset.state = state;
  panel.style.transform = '';
  $('sheet-handle').setAttribute('aria-expanded', String(state !== 'peek'));
  if (state !== 'full') $('panel-body').scrollTop = 0;
}
function sheetOffset(state) {
  const h = panel.offsetHeight;
  if (state === 'full') return 0;
  if (state === 'half') return Math.max(0, h - Math.round(innerHeight * 0.52));
  return Math.max(0, h - 188);
}
function visibleSheetHeight() {
  if (!mobileQuery.matches) return 0;
  return panel.offsetHeight - sheetOffset(panel.dataset.state);
}
(() => {
  const handle = $('sheet-handle');
  let startY = 0, startOffset = 0, dragging = false, moved = false;
  handle.addEventListener('pointerdown', e => {
    if (!mobileQuery.matches) return;
    dragging = true; moved = false; startY = e.clientY; startOffset = sheetOffset(panel.dataset.state);
    handle.setPointerCapture(e.pointerId); panel.classList.add('dragging');
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 4) moved = true;
    const offset = Math.min(sheetOffset('peek'), Math.max(0, startOffset + dy));
    panel.style.transform = `translateY(${offset}px)`;
  });
  const end = e => {
    if (!dragging) return;
    dragging = false; panel.classList.remove('dragging');
    if (!moved) { // Antippen: weiterschalten
      const i = SHEET_STATES.indexOf(panel.dataset.state);
      setSheet(i === SHEET_STATES.length - 1 ? 'peek' : SHEET_STATES[i + 1]);
      return;
    }
    const current = startOffset + (e.clientY - startY);
    const nearest = SHEET_STATES.reduce((best, s) => Math.abs(sheetOffset(s) - current) < Math.abs(sheetOffset(best) - current) ? s : best, 'peek');
    setSheet(nearest);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  $('search').addEventListener('focus', () => { if (mobileQuery.matches) setSheet('full'); });
})();

/* Punkt so zeigen, dass er nicht unter dem Panel verschwindet */
function focusPoint(latlng, zoom) {
  map.setView(latlng, zoom, {animate: false});
  const hidden = visibleSheetHeight();
  if (hidden) map.panBy([0, hidden / 2], {animate: false});
}

/* ---------- Popups und Ergebnisse ---------- */
function popup(h) {
  const el = document.createElement('div');
  el.className = 'popup';
  const title = document.createElement('strong');
  title.textContent = `Hydrant ${h.id}`;
  const meta = document.createElement('div');
  meta.className = 'popup-meta';
  meta.textContent = `${districtName(h)} · ${h.lat.toFixed(5)}, ${h.lng.toFixed(5)}`;
  const nav = document.createElement('div');
  nav.className = 'popup-links';
  nav.append(link('Google Maps ↗', navigation(h)), link('Apple Karten ↗', navigation(h, true)));
  const actions = document.createElement('div');
  actions.className = 'popup-actions';
  actions.append(button('Teilen', () => share(h), 'popup-btn'), button('＋ Notiz', () => openNote(h), 'popup-btn'));
  el.append(title, meta, nav, actions);
  return el;
}

function showHydrant(h) {
  if (!clusters.hasLayer(h.marker)) selectDistrict('');
  if (mobileQuery.matches && panel.dataset.state === 'full') setSheet('half');
  clusters.zoomToShowLayer(h.marker, () => {
    focusPoint([h.lat, h.lng], Math.max(map.getZoom(), 18));
    h.marker.openPopup();
  });
}

function renderResults(list, walking) {
  $('distance-label').textContent = walking ? 'Fußweg' : 'Luftlinie';
  $('results').replaceChildren(...list.map((h, i) => {
    const card = document.createElement('article');
    card.className = 'result';
    const top = document.createElement('div');
    top.className = 'result-top';
    const num = document.createElement('span');
    num.className = 'result-number'; num.textContent = i + 1;
    const title = document.createElement('div');
    title.className = 'result-title';
    title.textContent = `Hydrant ${h.id}`;
    const small = document.createElement('small');
    small.textContent = districtName(h);
    title.append(small);
    const dist = document.createElement('span');
    dist.className = 'distance';
    dist.textContent = meters(walking ? h.walk : h.d);
    if (walking && h.walkTime) {
      const t = document.createElement('small'); t.textContent = minutes(h.walkTime) + ' zu Fuß'; dist.append(t);
    }
    top.append(num, title, dist);
    const actions = document.createElement('div');
    actions.className = 'result-actions';
    actions.append(button('Auf Karte', () => showHydrant(h)), link('Google ↗', navigation(h)), link('Apple ↗', navigation(h, true)), button('Teilen', () => share(h)));
    card.append(top, actions);
    return card;
  }));
}

async function rank() {
  if (!origin || !hydrants.length) return;
  const token = ++rankToken;
  const candidates = hydrants.map(h => ({h, d: distance(origin, h)})).sort((a, b) => a.d - b.d).slice(0, 15)
    .map(({h, d}) => Object.assign(h, {d, walk: null, walkTime: null}));
  renderResults(candidates.slice(0, 5), false);
  if (mobileQuery.matches) {
    setSheet('half');
    const body = $('panel-body');
    body.scrollTop = document.querySelector('.results-section').offsetTop - body.offsetTop - 8;
  }
  if (!navigator.onLine) return;
  try {
    const q = new URLSearchParams({from: `${origin.lat},${origin.lng}`, to: candidates.map(h => `${h.lat},${h.lng}`).join(';')});
    const r = await fetch('/api/walk?' + q);
    if (!r.ok) throw new Error();
    const {distances, durations} = await r.json();
    if (token !== rankToken) return;
    candidates.forEach((h, i) => { h.walk = distances[i]; h.walkTime = durations[i]; });
    const walkable = candidates.filter(h => Number.isFinite(h.walk)).sort((a, b) => a.walk - b.walk);
    if (walkable.length >= 5) renderResults(walkable.slice(0, 5), true);
  } catch { /* Luftlinie bleibt stehen */ }
}

function setOrigin(point, label, accuracy) {
  origin = {lat: point.lat, lng: point.lng};
  if (originMarker) map.removeLayer(originMarker);
  if (accuracyCircle) map.removeLayer(accuracyCircle);
  originMarker = L.circleMarker(point, {radius: 8, color: '#fff', weight: 3, fillColor: '#2364b4', fillOpacity: 1}).addTo(map).bindTooltip('Dein Standort');
  if (accuracy) accuracyCircle = L.circle(point, {radius: accuracy, color: '#2364b4', weight: 1, fillOpacity: .07, interactive: false}).addTo(map);
  status(label);
  rank();
  focusPoint(point, 16);
}

function chooseMode(value) {
  mode = value;
  document.body.classList.add('picking');
  const tip = $('map-tip');
  tip.hidden = false;
  tip.textContent = value === 'report' ? 'Tippe auf die Position des fehlenden Hydranten' : 'Tippe auf die Karte, um deinen Standort zu setzen';
  if (mobileQuery.matches) setSheet('peek');
}
map.on('click', e => {
  if (!mode) return;
  const chosen = mode; mode = null;
  document.body.classList.remove('picking');
  $('map-tip').hidden = true;
  if (chosen === 'report') {
    reportPoint = e.latlng;
    if (reportMarker) map.removeLayer(reportMarker);
    reportMarker = L.marker(reportPoint).addTo(map);
    $('report-location').textContent = `Meldepunkt: ${reportPoint.lat.toFixed(6)}, ${reportPoint.lng.toFixed(6)}`;
    $('report-dialog').showModal();
  } else setOrigin(e.latlng, 'Standort auf der Karte gesetzt.');
});

/* ---------- Bezirke ---------- */
function insideRing([x, y], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function insidePolygon(p, rings) { return insideRing(p, rings[0]) && !rings.slice(1).some(r => insideRing(p, r)); }
function assignDistricts() {
  if (!districts.length || !hydrants.length) return;
  for (const h of hydrants) {
    const p = [h.lng, h.lat];
    h.district = districts.find(d => p[0] >= d.bbox[0] && p[0] <= d.bbox[2] && p[1] >= d.bbox[1] && p[1] <= d.bbox[3] && d.polygons.some(r => insidePolygon(p, r)))
      || districts.reduce((best, d) => { // Randpunkte: nächster Bezirksmittelpunkt
        const dist = (d.center[0] - p[0]) ** 2 + (d.center[1] - p[1]) ** 2;
        return !best || dist < best.dist ? {d, dist} : best;
      }, null).d;
  }
  for (const d of districts) d.hydrants = hydrants.filter(h => h.district === d);
  const select = $('district');
  select.append(...districts.map(d => new Option(`${d.nr}. ${d.name} (${fmt.format(d.hydrants.length)})`, String(d.nr))));
  select.disabled = false;
}
function selectDistrict(nr, fit = true) {
  activeDistrict = nr;
  $('district').value = nr;
  if (districtLayer) { map.removeLayer(districtLayer); districtLayer = null; }
  clusters.clearLayers();
  const d = districts.find(x => String(x.nr) === String(nr));
  const url = new URL(location.href);
  url.searchParams.delete('h');
  if (d) {
    clusters.addLayers(d.hydrants.map(h => h.marker));
    districtLayer = L.geoJSON(d.feature, {interactive: false, style: {color: '#172b29', weight: 2, dashArray: '6 6', fill: true, fillColor: '#172b29', fillOpacity: .04}}).addTo(map);
    $('district-info').textContent = `${fmt.format(d.hydrants.length)} Hydranten im ${d.nr}. Bezirk. Die nächsten Hydranten werden weiterhin in ganz Wien gesucht.`;
    url.searchParams.set('bezirk', d.nr);
    if (fit) {
      if (mobileQuery.matches) setSheet('peek');
      map.fitBounds(districtLayer.getBounds(), {paddingTopLeft: [20, 20], paddingBottomRight: [20, 20 + visibleSheetHeight()]});
    }
  } else {
    clusters.addLayers(hydrants.map(h => h.marker));
    $('district-info').textContent = '';
    url.searchParams.delete('bezirk');
  }
  history.replaceState(null, '', url.pathname + url.search);
}
$('district').onchange = e => selectDistrict(e.target.value);

/* ---------- Bedienelemente ---------- */
$('pick').onclick = () => chooseMode('origin');
$('overview').onclick = () => { selectDistrict(''); map.setView(VIENNA, 12); };
$('locate').onclick = () => {
  if (!navigator.geolocation) { status('GPS wird nicht unterstützt. Nutze die Adresse oder die Karte.'); return; }
  $('locate').disabled = true;
  status('Dein Standort wird ermittelt …');
  navigator.geolocation.getCurrentPosition(p => {
    $('locate').disabled = false;
    setOrigin({lat: p.coords.latitude, lng: p.coords.longitude}, `GPS-Standort · Genauigkeit ca. ${Math.round(p.coords.accuracy)} m`, p.coords.accuracy);
  }, e => {
    $('locate').disabled = false;
    status(e.code === 1 ? 'Standortzugriff nicht erlaubt. Nutze die Adresse oder die Karte.' : 'Standort nicht verfügbar. Bitte wähle ihn auf der Karte.');
  }, {enableHighAccuracy: true, timeout: 15000, maximumAge: 30000});
};
$('search-form').onsubmit = async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  if (!navigator.onLine) { status('Adresssuche braucht eine Internetverbindung. Setze den Standort auf der Karte.'); return; }
  btn.disabled = true; status('Adresse wird gesucht …'); $('search-results').replaceChildren();
  try {
    const r = await fetch('/api/search?q=' + encodeURIComponent($('search').value));
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    if (!data.length) { status('Keine Adresse gefunden. Bitte genauer suchen oder die Karte verwenden.'); return; }
    status('Wähle die passende Adresse.');
    $('search-results').append(...data.map(item => button(item.label, () => {
      $('search-results').replaceChildren(); $('search').blur();
      setOrigin({lat: item.lat, lng: item.lng}, item.label);
    }, 'search-result')));
  } catch (err) { status(err.message || 'Suche fehlgeschlagen.'); }
  finally { btn.disabled = false; }
};

/* ---------- Meldungen und Notizen ---------- */
document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => $(b.dataset.close).close(); });
$('report-open').onclick = () => { $('report-status').textContent = ''; $('report-dialog').showModal(); };
$('report-pick').onclick = () => { $('report-dialog').close(); chooseMode('report'); };
async function postForm(url, body, statusEl, submit, okText) {
  submit.disabled = true; statusEl.textContent = 'Wird gesendet …';
  try {
    const r = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    statusEl.textContent = okText;
    return true;
  } catch (err) {
    statusEl.textContent = navigator.onLine ? (err.message || 'Versand fehlgeschlagen. Bitte erneut versuchen.') : 'Keine Internetverbindung. Bitte später erneut senden.';
    return false;
  } finally { submit.disabled = false; }
}
$('report-form').onsubmit = async e => {
  e.preventDefault();
  if (!reportPoint) { $('report-status').textContent = 'Bitte zuerst den Meldepunkt auf der Karte setzen.'; return; }
  const ok = await postForm('/api/report', {lat: reportPoint.lat, lng: reportPoint.lng, description: $('description').value, email: $('email').value, website: $('website').value},
    $('report-status'), $('send-report'), 'Danke! Deine Meldung wurde zur Prüfung übermittelt.');
  if (ok) {
    $('report-form').reset(); reportPoint = null;
    $('report-location').textContent = 'Noch kein Meldepunkt ausgewählt.';
    if (reportMarker) map.removeLayer(reportMarker);
  }
};
let noteHydrant = null;
function openNote(h) {
  noteHydrant = h;
  $('note-hydrant').textContent = `Hydrant ${h.id} · ${districtName(h)}`;
  $('note-status').textContent = '';
  $('note-dialog').showModal();
}
$('note-form').onsubmit = async e => {
  e.preventDefault();
  if (!noteHydrant) return;
  const ok = await postForm('/api/note', {hydrantId: noteHydrant.id, lat: noteHydrant.lat, lng: noteHydrant.lng, description: $('note-description').value, email: $('note-email').value, website: $('note-website').value},
    $('note-status'), $('send-note'), 'Danke! Deine Notiz ist zur Prüfung eingegangen.');
  if (ok) $('note-form').reset();
};

/* ---------- Offline, Installation ---------- */
const updateOnline = () => { $('offline').hidden = navigator.onLine; };
addEventListener('online', updateOnline); addEventListener('offline', updateOnline); updateOnline();
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
let installPrompt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $('install').hidden = false; });
$('install').onclick = async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('install').hidden = true; };
mobileQuery.addEventListener('change', () => { setSheet('peek'); map.invalidateSize(); });
addEventListener('resize', () => map.invalidateSize());

/* ---------- Daten laden ---------- */
const getJSON = url => fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.json(); });
Promise.all([getJSON('/data/hydrants.geojson'), getJSON('/data/districts.geojson').catch(() => null)]).then(([data, districtData]) => {
  hydrants = data.features.filter(f => f.geometry?.type === 'Point').map(f => {
    const [lng, lat] = f.geometry.coordinates;
    const h = {id: String(f.properties.OBJECTID), lat, lng, district: null};
    h.marker = L.marker([lat, lng], {icon, keyboard: false}).bindPopup(() => popup(h));
    byId.set(h.id, h);
    return h;
  });
  if (districtData) {
    districts = districtData.features.map(f => {
      const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      const pts = polygons.flatMap(p => p[0]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      return {nr: f.properties.nr, name: f.properties.name, feature: f, polygons, bbox, center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]};
    }).sort((a, b) => a.nr - b.nr);
  } else $('district-section')?.remove();
  assignDistricts();
  const total = fmt.format(hydrants.length);
  $('count').textContent = total;
  $('count-intro').textContent = `Alle ${total}`;
  $('data-date').textContent = 'Datenstand: ' + new Date(data.timeStamp).toLocaleDateString('de-AT');
  const params = new URLSearchParams(location.search);
  selectDistrict(params.get('bezirk') || '', Boolean(params.get('bezirk')) && !params.get('h'));
  status(origin ? 'Hydranten geladen.' : 'Bereit. Wähle deinen Standort.');
  const linked = byId.get(params.get('h') || '');
  if (linked) { showHydrant(linked); history.replaceState(null, '', '/?h=' + linked.id); }
  rank();
}).catch(() => {
  status('Hydrantendaten konnten nicht geladen werden. Bitte die Seite neu laden.');
  $('results').textContent = 'Daten derzeit nicht verfügbar.';
});
