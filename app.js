'use strict';
/* Aurora Compass — pure math + parsing first (node-testable), DOM app below. */

const R_E = 6371;            // km
const H_LOW = 110, H_TOP = 300;  // aurora emission band altitude, km
const OVAL_THRESH = 8;       // OVATION % regarded as the visible band edge
const L1_KM = 1500000;       // DSCOVR distance sunward

const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;
const norm360 = d => ((d % 360) + 360) % 360;

function bearingTo(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1), p2 = toRad(lat2), dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return norm360(toDeg(Math.atan2(y, x)));
}

function angDist(lat1, lon1, lat2, lon2) {  // radians
  const p1 = toRad(lat1), p2 = toRad(lat2), dl = toRad(lon2 - lon1);
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  return Math.acos(Math.min(1, Math.max(-1, c)));
}

// Elevation of a point at altitude h km whose ground track is delta radians away.
function elevationOf(delta, h) {
  if (delta < 0.002) return 90;
  return toDeg(Math.atan((Math.cos(delta) - R_E / (R_E + h)) / Math.sin(delta)));
}

// Solar elevation (deg) — NOAA low-precision algorithm, good to ~0.2 deg.
function sunElevation(date, lat, lon) {
  const d = date.getTime() / 86400000 - 10957.5;  // days since J2000.0
  const g = toRad((357.529 + 0.98560028 * d) % 360);
  const q = (280.459 + 0.98564736 * d) % 360;
  const L = toRad(q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
  const e = toRad(23.439 - 0.00000036 * d);
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const RA = toDeg(Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)));
  const gmst = (280.46061837 + 360.98564736629 * d) % 360;
  const ha = toRad(norm360(gmst + lon - RA + 540) - 180);
  const p = toRad(lat);
  return toDeg(Math.asin(Math.sin(p) * Math.sin(dec) + Math.cos(p) * Math.cos(dec) * Math.cos(ha)));
}

// Dipole geomagnetic latitude (pole ~80.7N, 72.7W epoch ~2025).
function geomagLat(lat, lon) {
  const p = toRad(lat), l = toRad(lon), pp = toRad(80.7), lp = toRad(-72.7);
  return toDeg(Math.asin(Math.sin(p) * Math.sin(pp) + Math.cos(p) * Math.cos(pp) * Math.cos(l - lp)));
}

// Crude regional magnetic declination (deg E positive) — editable in UI.
function declEstimate(lat, lon) {
  if (lon >= -145 && lon < -100 && lat > 40) return 13;   // western Canada
  if (lon >= -100 && lon < -55 && lat > 40) return -10;   // eastern Canada
  if (lon >= -10 && lon <= 5 && lat > 45) return 1;       // UK / W Europe
  return 0;
}

function parseOvation(j) {
  const cols = [];
  for (let i = 0; i < 360; i++) cols.push(new Uint8Array(91));
  for (const c of j.coordinates) {
    if (c[1] >= 0) cols[c[0]][c[1]] = c[2];
  }
  return { obs: j["Observation Time"], fc: j["Forecast Time"], cols };
}

function analyzeLon(cols, lonE) {
  const col = cols[norm360(Math.round(lonE)) % 360];
  let boundary = -1, peakLat = -1, peakVal = 0;
  for (let la = 30; la <= 90; la++) {
    const v = col[la];
    if (v > peakVal) { peakVal = v; peakLat = la; }
    if (boundary < 0 && v >= OVAL_THRESH) boundary = la;
  }
  return { boundary, peakLat, peakVal };
}

function computeAurora(ov, lat, lon) {
  const m = analyzeLon(ov.cols, lon);
  const res = { peakVal: m.peakVal, boundaryLat: m.boundary, peakLat: m.peakLat,
                status: 'quiet', az: 0, azW: -35, azE: 35, elevLow: 0, elevTop: 0, distKm: 0 };
  if (m.peakVal < 3) return res;
  const bLat = m.boundary >= 0 ? m.boundary : m.peakLat;
  if (bLat <= lat + 1) {
    return Object.assign(res, { status: 'overhead', az: 0, elevLow: 50, elevTop: 88, distKm: 0 });
  }
  const delta = angDist(lat, lon, bLat, lon);
  res.status = 'north';
  res.az = bearingTo(lat, lon, bLat, lon);
  res.elevLow = elevationOf(delta, H_LOW);
  res.elevTop = elevationOf(delta, H_TOP) + 2;
  res.distKm = Math.round(delta * R_E);
  const w = analyzeLon(ov.cols, lon - 20), e = analyzeLon(ov.cols, lon + 20);
  const wLat = w.boundary >= 0 ? w.boundary : bLat, eLat = e.boundary >= 0 ? e.boundary : bLat;
  res.azW = bearingTo(lat, lon, wLat, lon - 20);
  res.azE = bearingTo(lat, lon, eLat, lon + 20);
  if (res.elevLow < -2) res.status = 'below-horizon';
  return res;
}

function makeVerdict(aur, sunEl, cloudNow, bz) {
  if (sunEl != null && sunEl > -6) return { label: 'DAYLIGHT', cls: 'bad', note: 'Sky too bright — check back after dark (~23:00 local).' };
  if (!aur || aur.peakVal < OVAL_THRESH) return { label: 'QUIET', cls: 'dim', note: 'Aurora oval is weak over your longitude right now.' };
  if (aur.status === 'below-horizon') return { label: 'TOO FAR NORTH', cls: 'dim', note: 'Band edge ~' + aur.distKm + ' km north — below your horizon. Needs a stronger push (higher Kp).' };
  if (cloudNow != null && cloudNow >= 75) return { label: 'CLOUDED OUT', cls: 'bad', note: 'Overcast at your spot — watch the cloud strip for a break.' };
  const strong = aur.peakVal >= 30 || (bz != null && bz <= -5);
  if (aur.status === 'overhead') return strong
    ? { label: 'GO — LOOK UP', cls: 'go', note: 'The oval is over you. Get away from lights NOW.' }
    : { label: 'POSSIBLE OVERHEAD', cls: 'mid', note: 'Oval near your zenith — worth stepping outside.' };
  return strong
    ? { label: 'GO — LOOK NORTH', cls: 'go', note: 'Active band low on the northern horizon. Use the compass below.' }
    : { label: 'MARGINAL', cls: 'mid', note: 'Faint band possible low north — a 5–10 s phone exposure will see it first.' };
}

function lastValid(rows, idx) {  // SWPC "products" format: rows[0]=header
  for (let i = rows.length - 1; i > 0; i--) {
    const v = parseFloat(rows[i][idx]);
    if (isFinite(v)) return { v, t: rows[i][0] };
  }
  return null;
}

if (typeof module !== 'undefined') {
  module.exports = { bearingTo, angDist, elevationOf, sunElevation, geomagLat,
    declEstimate, parseOvation, analyzeLon, computeAurora, makeVerdict, lastValid, norm360 };
}

/* ---------------- DOM app ---------------- */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {

const APP_VERSION = 114;

if ('serviceWorker' in navigator) {
  try { navigator.serviceWorker.register('sw.js'); } catch (e) {}
}

const URLS = {
  kp: 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
  mag: 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json',
  plasma: 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json',
  ovation: 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json',
  fc: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json'
};

const S = { loc: null, head: null, pitch: null, decl: 0, usedWk: false, cAcc: null, hSmooth: null,
            kp: null, bz: null, speed: null, ov: null, aur: null,
            clouds: null, cloudIdx: -1, cloudOffset: 0, sun: null, started: false,
            lastOk: null, cacheAt: null, fc: null };

const $ = id => document.getElementById(id);

async function jget(u) {
  const sig = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(15000) : undefined;
  const r = await fetch(u, { cache: 'no-store', signal: sig });
  if (!r.ok) throw new Error(u + ' ' + r.status);
  S.lastOk = Date.now();
  return r.json();
}

/* ---- offline cache: keep the last good data across signal loss & relaunch ---- */
function packCols(cols) {
  let s = '';
  for (let lo = 0; lo < 360; lo++)
    for (let la = 30; la <= 90; la++) s += String.fromCharCode(cols[lo][la]);
  return btoa(s);
}
function unpackCols(b64) {
  const s = atob(b64), cols = [];
  for (let i = 0; i < 360; i++) cols.push(new Uint8Array(91));
  let k = 0;
  for (let lo = 0; lo < 360; lo++)
    for (let la = 30; la <= 90; la++) cols[lo][la] = s.charCodeAt(k++);
  return cols;
}
function saveCache() {
  try {
    const o = { savedAt: Date.now(), kp: S.kp, bz: S.bz, speed: S.speed, loc: S.loc,
      clouds: S.clouds, cloudOffset: S.cloudOffset,
      stampSw: $('stampSw').textContent,
      fc: (S.fc || []).map(r => ({ t: r.t.toISOString(), kp: r.kp, past: r.past, g: r.g })) };
    if (S.ov) o.ov = { obs: S.ov.obs, fc: S.ov.fc, packed: packCols(S.ov.cols) };
    localStorage.setItem('ac1', JSON.stringify(o));
  } catch (e) {}
}
function loadCache() {
  try {
    const o = JSON.parse(localStorage.getItem('ac1') || 'null');
    if (!o) return;
    S.cacheAt = o.savedAt;
    if (S.kp == null && o.kp != null) S.kp = o.kp;
    if (S.bz == null && o.bz != null) S.bz = o.bz;
    if (S.speed == null && o.speed != null) S.speed = o.speed;
    if (!S.ov && o.ov && o.ov.packed) S.ov = { obs: o.ov.obs, fc: o.ov.fc, cols: unpackCols(o.ov.packed) };
    if (!S.clouds && o.clouds) {
      S.clouds = o.clouds; S.cloudOffset = o.cloudOffset || 0;
      const nowLocal = new Date(Date.now() + S.cloudOffset * 1000).toISOString().slice(0, 13);
      S.cloudIdx = S.clouds.time.findIndex(t => t.slice(0, 13) === nowLocal);
    }
    if (o.stampSw && $('stampSw').textContent === '–') $('stampSw').textContent = o.stampSw;
    if (!S.fc && o.fc) S.fc = o.fc.map(r => ({ t: new Date(r.t), kp: r.kp, past: r.past, g: r.g }));
    if (!S.loc && o.loc) setLoc(o.loc.lat, o.loc.lon, (o.loc.name || 'last position') + ' · cached');
  } catch (e) {}
}

/* ---- data feeds ---- */
async function updKp() {
  try {
    const j = await jget(URLS.kp);
    S.kp = j[j.length - 1].estimated_kp;
    saveCache();
  } catch (e) {}
}
function fmtT(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
async function updWind() {
  try {
    const [mag, pla] = await Promise.all([jget(URLS.mag), jget(URLS.plasma)]);
    const bz = lastValid(mag, 3), sp = lastValid(pla, 2);
    if (bz) S.bz = bz.v;
    if (sp) S.speed = sp.v;
    if (bz) {
      const t = new Date(bz.t.replace(' ', 'T') + 'Z');
      const age = Math.max(0, Math.round((Date.now() - t.getTime()) / 60000));
      let s = 'measured at DSCOVR ' + fmtT(t) + ' (' + (age <= 1 ? 'just now' : age + ' min ago') + ')';
      if (sp) s += ' · reaches Earth ~' + fmtT(new Date(t.getTime() + L1_KM / sp.v * 1000));
      $('stampSw').textContent = (age > 10 ? '⚠️ stale · ' : '') + s + ' ⓘ';
      saveCache();
    }
  } catch (e) {}
}
async function updOvation() {
  try {
    const j = await jget(URLS.ovation);
    S.ov = parseOvation(j);
    const fc = S.ov.fc ? new Date(S.ov.fc) : null;
    $('stampOv').textContent = fc ? 'oval forecast valid for ~' + fmtT(fc) + ' your time' : '';
    saveCache();
  } catch (e) {}
}
async function updClouds() {
  if (!S.loc) return;
  try {
    const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + S.loc.lat.toFixed(3) +
      '&longitude=' + S.loc.lon.toFixed(3) +
      '&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high&forecast_days=2&timezone=auto';
    const j = await jget(u);
    S.clouds = j.hourly;
    S.cloudOffset = j.utc_offset_seconds || 0;
    const nowLocal = new Date(Date.now() + S.cloudOffset * 1000).toISOString().slice(0, 13);
    S.cloudIdx = S.clouds.time.findIndex(t => t.slice(0, 13) === nowLocal);
    saveCache();
  } catch (e) {}
}
async function updForecast() {
  try {
    const j = await jget(URLS.fc);
    S.fc = j.map(r => ({
      t: new Date(r.time_tag.replace(' ', 'T') + 'Z'),
      kp: r.kp, past: r.observed === 'observed', g: r.noaa_scale || null
    }));
    saveCache();
  } catch (e) {}
}

function cloudNow() {
  if (!S.clouds || S.cloudIdx < 0) return null;
  return S.clouds.cloud_cover[S.cloudIdx];
}

/* ---- sensors ---- */
function armOrientation() {
  window.addEventListener('deviceorientation', e => {
    let h = null;
    if (e.webkitCompassHeading != null && !isNaN(e.webkitCompassHeading)) {
      h = e.webkitCompassHeading;                 // iOS: already a true-north compass heading
      S.usedWk = true;
      if (e.webkitCompassAccuracy != null) S.cAcc = e.webkitCompassAccuracy;
    } else if (!S.usedWk && e.alpha != null) {
      h = norm360(360 - e.alpha);                 // Android/other fallback
    }
    if (h != null) {
      h = norm360(h + S.decl);                     // decl = optional manual nudge (default 0)
      // circular smoothing damps jitter and brief glitches without lagging real turns much
      if (S.hSmooth == null) S.hSmooth = h;
      else { const d = ((h - S.hSmooth + 540) % 360) - 180; S.hSmooth = norm360(S.hSmooth + d * 0.3); }
      S.head = S.hSmooth;
    }
    if (e.beta != null) S.pitch = e.beta - 90;  // portrait, screen toward you
  }, true);
}
function setLoc(lat, lon, name) {
  S.loc = { lat, lon, name: name || (lat.toFixed(2) + ', ' + lon.toFixed(2)) };
  $('vPlace').textContent = '📍 ' + S.loc.name + ' (' + lat.toFixed(3) + ', ' + lon.toFixed(3) + ')';
  $('vGm').textContent = geomagLat(lat, lon).toFixed(0) + '°';
  updClouds();
}

function start(fromPreset) {
  if (!fromPreset && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      p => setLoc(p.coords.latitude, p.coords.longitude, 'your position'),
      () => { if (!S.loc) setLoc(52.874, -118.081, 'Jasper (GPS denied — preset)'); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }
  if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
    DeviceOrientationEvent.requestPermission().then(p => { if (p === 'granted') armOrientation(); }).catch(() => {});
  } else armOrientation();
  $('overlay').style.display = 'none';
  if (!S.started) {
    S.started = true;
    S.startedAt = Date.now();
    loadCache();
    updKp(); updWind(); updOvation(); updForecast();
    setInterval(updKp, 60000); setInterval(updWind, 60000);
    setInterval(updOvation, 300000); setInterval(updClouds, 1800000);
    setInterval(updForecast, 10800000);
  }
}

/* ---- screen wake lock, tied to Night mode (for the lakeside vigil) ---- */
let wakeLock = null;
async function setWake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else if (wakeLock) { wakeLock.release(); wakeLock = null; }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && document.body.classList.contains('red')) setWake(true);
});

/* ---- rendering ---- */
function fitCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  // Remember the DESIGN height once — cv.height assignment rewrites the height
  // attribute, so re-reading it each frame compounds by dpr and blows up the canvas.
  if (!cv.dataset.h) cv.dataset.h = cv.getAttribute('height') || 200;
  const w = cv.clientWidth || cv.parentElement.clientWidth - 28;
  const h = parseInt(cv.dataset.h);
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function drawCompass() {
  const cv = $('cvCompass');
  const { ctx, w, h } = fitCanvas(cv);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 18;
  ctx.clearRect(0, 0, w, h);
  const head = S.head || 0;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(toRad(-head));
  ctx.strokeStyle = '#22304d'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  for (let a = 0; a < 360; a += 15) {
    const big = a % 90 === 0;
    ctx.save(); ctx.rotate(toRad(a));
    ctx.strokeStyle = big ? '#5b6f96' : '#26344f';
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, -r + (big ? 12 : 6)); ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#9fb2d2'; ctx.font = '600 15px -apple-system,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  [['N', 0, '#ff6b6b'], ['E', 90, '#9fb2d2'], ['S', 180, '#9fb2d2'], ['W', 270, '#9fb2d2']].forEach(([t, a, col]) => {
    ctx.save(); ctx.rotate(toRad(a)); ctx.translate(0, -r + 26); ctx.rotate(toRad(-a + head));
    ctx.fillStyle = col; ctx.fillText(t, 0, 0); ctx.restore();
  });
  if (S.aur && S.aur.peakVal >= 3 && S.aur.status !== 'quiet') {
    let a1 = S.aur.azW, a2 = S.aur.azE;
    if (S.aur.status === 'overhead') { a1 = 0; a2 = 359.9; }
    if (norm360(a2 - a1) < 24) { const c = S.aur.az; a1 = c - 12; a2 = c + 12; }
    const alpha = Math.min(0.9, 0.3 + S.aur.peakVal / 60);
    ctx.strokeStyle = 'rgba(89,255,160,' + alpha + ')';
    ctx.lineWidth = 13; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, r, toRad(a1 - 90), toRad((norm360(a2 - a1) ? a2 : a1 + 0.1) - 90), false);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = '#59ffa0';
  ctx.beginPath(); ctx.moveTo(cx, cy - r - 4); ctx.lineTo(cx - 7, cy - r + 12); ctx.lineTo(cx + 7, cy - r + 12); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#54648a'; ctx.font = '11px -apple-system,sans-serif';
  ctx.fillText(S.head == null ? 'compass off — tap Start' : Math.round(norm360(S.head)) + '°', cx, cy);
}

const STARS = Array.from({ length: 70 }, (_, i) => [((i * 137.5) % 360) / 360, ((i * 73.1) % 70) / 70]);

function drawDome(t) {
  const cv = $('cvDome');
  const { ctx, w, h } = fitCanvas(cv);
  const y0 = h - 26;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#070d1c'); g.addColorStop(1, '#0b1426');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(220,231,245,.5)';
  STARS.forEach(([sx, sy]) => ctx.fillRect(sx * w, sy * (y0 - 12), 1.2, 1.2));
  const aur = S.aur;
  const center = aur && aur.status !== 'quiet' ? aur.az : 0;
  const span = 70;
  const azToX = az => ((((az - center + 540) % 360) - 180) + span) / (2 * span) * w;
  const elToY = el => y0 - Math.max(0, Math.min(75, el)) / 75 * (y0 - 10);
  if (aur && aur.peakVal >= 3 && aur.status !== 'quiet' && aur.status !== 'below-horizon') {
    const lo = aur.status === 'overhead' ? 50 : Math.max(0.5, aur.elevLow);
    const hi = aur.status === 'overhead' ? 86 : Math.max(lo + 3, aur.elevTop);
    const alpha = Math.min(0.75, 0.18 + aur.peakVal / 70);
    for (let x = 0; x <= w; x += 4) {
      const fl = Math.sin(t / 700 + x / 23) * 0.06 + Math.sin(t / 1900 + x / 51) * 0.05;
      const yTop = elToY(hi * (1 + fl)), yBot = elToY(lo);
      const gg = ctx.createLinearGradient(0, yTop, 0, yBot);
      gg.addColorStop(0, 'rgba(89,255,160,0)');
      gg.addColorStop(0.55, 'rgba(89,255,160,' + alpha + ')');
      gg.addColorStop(1, 'rgba(60,220,140,' + alpha * 0.5 + ')');
      ctx.fillStyle = gg; ctx.fillRect(x, yTop, 4, Math.max(1, yBot - yTop));
    }
  } else if (aur && aur.status === 'below-horizon') {
    ctx.strokeStyle = 'rgba(89,255,160,.35)'; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(0, y0 + 12); ctx.lineTo(w, y0 + 12); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#7f93b3'; ctx.font = '12px -apple-system,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('band beyond horizon — ' + aur.distKm + ' km north', w / 2, y0 - 30);
  } else {
    ctx.fillStyle = '#54648a'; ctx.font = '12px -apple-system,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('no significant aurora over your longitude right now', w / 2, y0 - 30);
  }
  ctx.strokeStyle = '#33415f'; ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w, y0); ctx.stroke();
  ctx.fillStyle = '#7f93b3'; ctx.font = '11px -apple-system,sans-serif'; ctx.textAlign = 'center';
  [['NW', 315], ['N', 0], ['NE', 45], ['E', 90], ['W', 270]].forEach(([lbl, az]) => {
    const x = azToX(az);
    if (x >= 12 && x <= w - 12) {
      ctx.fillStyle = lbl === 'N' ? '#ff6b6b' : '#7f93b3';
      ctx.fillText(lbl, x, y0 + 14);
    }
  });
  if (S.head != null) {
    const x = azToX(norm360(S.head));
    if (x >= 0 && x <= w) {
      const y = S.pitch != null ? elToY(Math.max(0, Math.min(75, S.pitch))) : y0 - 14;
      ctx.strokeStyle = '#dce7f5'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 14); ctx.lineTo(x, y + 14); ctx.stroke();
    }
  }
}

function drawClouds() {
  const cv = $('cvClouds');
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  if (!S.clouds || S.cloudIdx < 0) {
    ctx.fillStyle = '#54648a'; ctx.font = '12px -apple-system,sans-serif';
    ctx.fillText('cloud data loads once location is set…', 10, h / 2);
    return;
  }
  const N = 12, x0 = 26, bw = (w - x0 - 4) / N;
  const rows = [['cloud_cover_high', 'Hi'], ['cloud_cover_mid', 'Mid'], ['cloud_cover_low', 'Low']];
  const rh = (h - 38) / 3;
  rows.forEach(([key, lbl], ri) => {
    ctx.fillStyle = '#7f93b3'; ctx.font = '10px -apple-system,sans-serif';
    ctx.textAlign = 'left'; ctx.fillText(lbl, 2, 14 + ri * rh + rh / 2);
    for (let i = 0; i < N; i++) {
      const v = S.clouds[key][S.cloudIdx + i] ?? 0;
      ctx.fillStyle = 'rgba(159,178,210,' + (0.06 + 0.85 * v / 100) + ')';
      ctx.fillRect(x0 + i * bw + 1, 8 + ri * rh, bw - 2, rh - 4);
    }
  });
  ctx.fillStyle = '#7f93b3'; ctx.textAlign = 'center'; ctx.font = '10px -apple-system,sans-serif';
  for (let i = 0; i < N; i += 2) {
    const tstr = S.clouds.time[S.cloudIdx + i];
    if (tstr) ctx.fillText(tstr.slice(11, 13) + 'h', x0 + i * bw + bw / 2, h - 6);
  }
  let bestDark = null, avgDark = 101, bestAny = null, avgAny = 101;
  for (let i = 0; i < N - 1; i++) {
    const idx = S.cloudIdx + i;
    const t = S.clouds.time[idx];
    const a = S.clouds.cloud_cover[idx], b = S.clouds.cloud_cover[idx + 1];
    if (!t || a == null || b == null) break;
    const avg = (a + b) / 2;
    if (avg < avgAny) { avgAny = avg; bestAny = t; }
    const hr = parseInt(t.slice(11, 13), 10);
    if ((hr >= 22 || hr <= 4) && avg < avgDark) { avgDark = avg; bestDark = t; }
  }
  let note;
  if (bestDark) note = 'Clearest DARK-hours window ~' + bestDark.slice(11, 16) + ' (' + Math.round(avgDark) + '% cover)';
  else if (bestAny) note = 'Clearest ~' + bestAny.slice(11, 16) + ' (' + Math.round(avgAny) + '% cover) — daylight; dark hours not in view yet';
  else note = 'No cloud data';
  $('cloudNote').textContent = note + ' · pale = cloud, dark = clear';
}

function tick(t) {
  if (S.loc) {
    S.sun = sunElevation(new Date(), S.loc.lat, S.loc.lon);
    $('vSun').textContent = S.sun.toFixed(0) + '°';
    if (S.ov) S.aur = computeAurora(S.ov, S.loc.lat, S.loc.lon);
  }
  $('vKp').textContent = S.kp != null ? S.kp.toFixed(1) : '–';
  if (S.kp != null) $('vKp').className = S.kp >= 5 ? 'bad' : S.kp >= 4 ? 'good' : S.kp >= 3 ? 'warn' : '';
  $('vBz').textContent = S.bz != null ? S.bz.toFixed(1) : '–';
  if (S.bz != null) $('vBz').className = S.bz <= -5 ? 'good' : S.bz < 0 ? 'warn' : '';
  $('vWind').textContent = S.speed != null ? Math.round(S.speed) : '–';
  $('vEta').textContent = S.speed ? Math.round(L1_KM / S.speed / 60) + ' min' : '–';
  const eng = $('engine');
  if (S.bz != null) {
    eng.innerHTML = 'Engine: <b>' + (S.bz <= -5 ? 'SURGING — Bz strongly south; watch the next ' :
      S.bz < 0 ? 'favourable — Bz south; mild activity possible in ~' :
      'idle — Bz north; little energy coupling for the next ~') +
      (S.speed ? Math.round(L1_KM / S.speed / 60) + ' min' : '–') + '</b> ⓘ';
  }
  const v = makeVerdict(S.aur, S.sun, cloudNow(), S.bz);
  $('verdict').textContent = v.label; $('verdict').className = v.cls; $('vnote').textContent = v.note;
  const offBar = $('offBar');
  const offline = S.started && S.startedAt && Date.now() - S.startedAt > 10000 &&
    (!S.lastOk || Date.now() - S.lastOk > 180000);
  offBar.hidden = !offline;
  if (offline) {
    const ref = S.lastOk || S.cacheAt;
    offBar.textContent = '📵 No data link — showing ' + (ref ? 'data from ' + fmtT(new Date(ref)) : 'no data') +
      '. Compass, sky position & tilt still work — they\'re computed on the phone. Your eyes are the live sensor now.';
  }
  if (S.aur && (S.aur.status === 'north')) {
    if (S.head != null) {
      const diff = ((S.aur.az - S.head + 540) % 360) - 180;
      $('turnTxt').textContent = Math.abs(diff) < 10 ? '✓ on it' : (diff > 0 ? '→ ' : '← ') + Math.round(Math.abs(diff)) + '°';
    } else $('turnTxt').textContent = 'az ' + Math.round(S.aur.az) + '°';
    $('elevTxt').textContent = Math.round(Math.max(0, S.aur.elevLow)) + '–' + Math.round(Math.max(0, S.aur.elevTop)) + '°';
    $('distTxt').textContent = S.aur.distKm + ' km';
  } else if (S.aur && S.aur.status === 'overhead') {
    $('turnTxt').textContent = 'any'; $('elevTxt').textContent = 'look up'; $('distTxt').textContent = 'over you';
  } else {
    $('turnTxt').textContent = '–'; $('elevTxt').textContent = '–'; $('distTxt').textContent = '–';
  }
  const cal = $('calNote');
  if (cal) {
    if (S.head == null) { cal.className = 'warn'; cal.textContent = 'Compass off — tap Start and allow Motion access.'; }
    else if (S.cAcc != null && S.cAcc > 25) { cal.className = 'bad'; cal.textContent = '⚠️ Compass needs calibrating — wave the phone in a slow figure-8, and step away from the car / any magnetic case.'; }
    else { cal.className = 'ok'; cal.textContent = 'If north looks wrong: wave a figure-8 to calibrate, and keep clear of the car & magnetic/MagSafe cases.' + (S.cAcc != null && S.cAcc >= 0 ? ' (±' + Math.round(S.cAcc) + '°)' : ''); }
  }
  drawCompass(); drawDome(t); drawClouds(); drawKp();
}

function drawKp() {
  const cv = $('cvKp'); if (!cv) return;
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  if (!S.fc || !S.fc.length) {
    ctx.fillStyle = '#54648a'; ctx.font = '12px -apple-system,sans-serif';
    ctx.fillText('Kp forecast loading…', 10, h / 2); return;
  }
  const nowMs = Date.now();
  const up = S.fc.filter(r => r.t.getTime() > nowMs - 3 * 3600 * 1000).slice(0, 12);
  if (!up.length) return;
  const x0 = 4, top = 12, yb = h - 24, N = up.length, bw = (w - x0 - 4) / N;
  const yOf = kp => yb - Math.min(9, kp) / 9 * (yb - top);
  let darkPeak = null, anyPeak = null;
  // smooth day→night background painted from the sun's elevation at this spot/time
  const plotW = w - x0 - 4, t0 = up[0].t.getTime(), tEnd = up[N - 1].t.getTime() + 3 * 3600 * 1000;
  const sunAt = ms => S.loc ? sunElevation(new Date(ms), S.loc.lat, S.loc.lon) : -18;
  for (let px = 0; px < plotW; px += 3) {
    const el = sunAt(t0 + (px / plotW) * (tEnd - t0));
    const d = Math.max(0, Math.min(1, (6 - el) / 24));   // 0 = full daylight, 1 = astronomical night
    const r = Math.round(58 - 52 * d), g = Math.round(80 - 70 * d), b = Math.round(124 - 104 * d);
    ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
    ctx.fillRect(x0 + px, top, 3, yb - top);
  }
  up.forEach((r, i) => {
    const x = x0 + i * bw, dark = sunAt(r.t.getTime() + 5400000) < -6;  // dark at bin midpoint
    const y = yOf(r.kp);
    const col = r.kp >= 5 ? '#8affc0' : r.kp >= 4 ? '#59ffa0' : r.kp >= 3 ? '#ffb454' : '#9fb4d8';
    const bx = x + 1.5, bwid = Math.max(1, bw - 3), bh = yb - y;
    ctx.globalAlpha = r.past ? 0.45 : 1;
    ctx.fillStyle = col; ctx.fillRect(bx, y, bwid, bh);
    // dark outline so even low bars stay visible over the bright daytime background
    ctx.globalAlpha = r.past ? 0.35 : 0.8;
    ctx.strokeStyle = 'rgba(2,6,12,.9)'; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, y + 0.5, bwid - 1, bh - 0.5);
    ctx.globalAlpha = 1;
    if (r.g) { ctx.fillStyle = '#cfeede'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(r.g, x + bw / 2, y - 2); }
    if (i % 2 === 0) { ctx.fillStyle = '#c3cfe6'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(fmtT(r.t), x + bw / 2, h - 9); }
    if (!r.past) {
      if (!anyPeak || r.kp > anyPeak.kp) anyPeak = r;
      if (dark && (!darkPeak || r.kp > darkPeak.kp)) darkPeak = r;
    }
  });
  ctx.strokeStyle = '#33415f'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, yb); ctx.lineTo(w - 2, yb); ctx.stroke();
  // threshold lines drawn ON TOP so they stay readable over the bars
  ctx.setLineDash([5, 3]); ctx.lineWidth = 1.4;
  [['Kp 4 — reaches Jasper', 4, 'rgba(255,180,84,.85)', '#ffce8f'],
   ['Kp 5 — storm', 5, 'rgba(120,255,184,.9)', '#a6ffcf']].forEach(([lbl, k, line, txt]) => {
    const y = yOf(k); ctx.strokeStyle = line;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(w - 2, y); ctx.stroke();
    ctx.fillStyle = txt; ctx.font = '600 9.5px sans-serif'; ctx.textAlign = 'right'; ctx.fillText(lbl, w - 3, y - 3);
  });
  ctx.setLineDash([]);
  let note = '';
  if (darkPeak) note = '🌙 Dark-hours peak Kp ' + darkPeak.kp.toFixed(1) + ' at ' + fmtT(darkPeak.t) + (darkPeak.g ? ' (' + darkPeak.g + ')' : '');
  if (anyPeak && sunAt(anyPeak.t.getTime() + 5400000) > -6 && (!darkPeak || anyPeak.kp > darkPeak.kp + 0.4))
    note += (note ? ' · ' : '') + '⚠️ biggest spike Kp ' + anyPeak.kp.toFixed(1) + ' at ' + fmtT(anyPeak.t) + ' is in daylight';
  $('kpNote').textContent = note || 'background = daylight (lighter) → night (darker) · faded bars = past';
}

let last = 0;
function loop(t) {
  if (t - last > 120) { last = t; tick(t); }
  requestAnimationFrame(loop);
}

/* ---- jargon tooltips: tap any ⓘ element ---- */
const TIPS = {
  kp: '<b>Kp — global aurora activity, 0–9.</b> How disturbed Earth\'s magnetic field is (1-minute estimate here). From Jasper\'s latitude the band usually reaches your sky at <b>Kp ≈ 4</b>; Kp 5+ is storm level and can put it overhead. Kp looks BACK (3-h average) — for what\'s coming, watch Bz.',
  bz: '<b>Bz — the door. North–south tilt of the solar wind\'s magnetic field, in nanotesla.</b> Earth\'s field points north, so a SOUTH (negative) Bz lets the fields reconnect and aurora energy pour in. <b>≤ −5 = good zone (green)</b>; below −10 for an hour = storm. Positive/north = door shut, even in fast wind.',
  wind: '<b>Solar-wind speed at DSCOVR.</b> Calm sun ~350–400 km/s. 500–700+ km/s (high-speed stream or CME) makes any south-Bz hit much harder — speed × south-field = power.',
  eta: '<b>L1 lead — your early warning, courtesy of DSCOVR.</b> DSCOVR is NOAA\'s space-weather buoy, parked 1.5 million km sunward at L1 — the spot where Sun and Earth gravity balance, so everything the Sun throws at us blows past it FIRST. It radios back the wind\'s speed and Bz in real time; the wind then needs this many minutes to cover the last stretch to Earth. If Bz dives south, this is how long you have to get outside before the sky responds. (Bonus: DSCOVR also takes the full-disc “whole Earth” photos.)',
  engine: '<b>Engine = is energy flowing in right now?</b> Combines Bz direction with wind speed: <b>surging</b> (Bz ≤ −5 — get outside soon), <b>favourable</b> (Bz south — door ajar), <b>idle</b> (Bz north — door shut). The minutes are the L1 lead: how long until what DSCOVR sees now reaches Earth.',
  compass: '<b>How to use:</b> the dial turns with your phone — red N is true north, the <b>green arc is where the aurora band sits</b>. “Rotate” says how far to turn (✓ when you\'re facing it), “tilt” is how high above the horizon to look (0° = flat horizon), “band edge” is the ground distance to where the glow starts. <b>If north seems wrong:</b> the phone\'s magnetometer needs calibrating — wave the phone in a slow figure-8 a few times, and stand clear of the car and any magnetic / MagSafe case (both swing a phone compass hard).',
  sky: '<b>OVATION</b> is NOAA\'s live model of the auroral oval, updated every few minutes from the solar wind measured ~40 min upstream. The green band is where the glow should sit in <b>your</b> sky; the crosshair is where your phone points. The shimmer is simulated — brightness scales with the model\'s intensity.',
  clouds: '<b>Low / Mid / High = three cloud layers</b> for your exact spot, next 12 h. Cells are drawn like clouds against a night sky: <b>pale/bright = cloud, dark = clear</b>. Low cloud kills the show; thin high cirrus often doesn\'t (bright aurora shines through). The note picks the clearest window in the DARK hours (22:00–04:00) — the only ones that matter for aurora.',
  outlook: '<b>3-hourly Kp forecast (NOAA), in your local time</b> — Kp is defined in 3-hour blocks, so this is the finest a Kp forecast gets. The <b>background fades from daylight (lighter) to night (darker)</b> by the real sun position — the dark stretch is your viewing window. Faded bars = already past; G1–G5 mark storm bars; dashed lines = Kp 4 (reaches Jasper) and Kp 5 (storm). Watch for a big spike landing in daylight — it\'s wasted. For finer-than-3h timing, use the live Bz / L1-lead up top.',
  terms: '<b>Geomagnetic lat</b> — your latitude measured from the magnetic pole, the one aurora cares about (Jasper: 53° geographic ≈ 59° magnetic — why it\'s great aurora country). <b>Sun</b> — degrees below the horizon; you want ≤ −6°, and June here bottoms out ~−13°. <b>Compass correction</b> — a manual nudge, normally leave at 0 (your iPhone already points to true north). If the dial reads consistently wrong by some fixed amount, dial it in here; but figure-8 calibration fixes most errors.',
  dscovr: '<b>Data freshness line.</b> When the numbers above were measured at the DSCOVR satellite (shown in your local time, with age), and when that same parcel of wind reaches Earth — measured time + L1 lead. It updates every minute; if it falls more than ~10 min behind, the feed has a gap (⚠️ appears) — tap ↻ and trust your eyes meanwhile. See the “L1 lead ⓘ” tile for what DSCOVR is.'
};
let tipSel = null;
document.addEventListener('click', e => {
  if (e.target.tagName === 'INPUT') return;
  const t = e.target.closest('[data-tip]');
  if (!t) return;
  const key = t.dataset.tip, box = $('tipBox');
  document.querySelectorAll('.sel').forEach(s => s.classList.remove('sel'));
  if (tipSel === key) { tipSel = null; box.hidden = true; return; }
  tipSel = key;
  if (t.classList.contains('stat')) t.classList.add('sel');
  const anchor = t.classList.contains('stat') ? t.parentElement : t;
  anchor.insertAdjacentElement('afterend', box);
  box.innerHTML = TIPS[key] || ''; box.hidden = false;
});

/* ---- wiring ---- */
$('btnStart').addEventListener('click', () => start(false));
document.querySelectorAll('.preset').forEach(b => b.addEventListener('click', () => {
  setLoc(parseFloat(b.dataset.lat), parseFloat(b.dataset.lon), b.dataset.name);
  start(true);
}));
$('btnRed').addEventListener('click', () => {
  const on = document.body.classList.toggle('red');
  setWake(on);
});
$('btnRefresh').addEventListener('click', () => { updKp(); updWind(); updOvation(); updClouds(); updForecast(); });
$('vDecl').addEventListener('change', e => { S.decl = parseFloat(e.target.value) || 0; });

const qp = new URLSearchParams(location.search);
if (qp.get('lat') && qp.get('lon')) {
  setLoc(parseFloat(qp.get('lat')), parseFloat(qp.get('lon')), qp.get('name') || 'URL location');
  start(true);
}

/* ---- self-update: Home-Screen copies don't refresh on their own ---- */
let updating = false;
async function checkUpdate() {
  if (updating) return;
  try {
    const r = await fetch('version.json?ts=' + Math.floor(Date.now() / 60000), { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (j.v && j.v > APP_VERSION) {
      updating = true;
      const bar = document.createElement('div');
      bar.id = 'updBar';
      bar.textContent = '✨ Updating to v' + j.v + '…';
      document.body.appendChild(bar);
      setTimeout(() => location.reload(), 1200);
    }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
setInterval(checkUpdate, 600000);
checkUpdate();

requestAnimationFrame(loop);
}
