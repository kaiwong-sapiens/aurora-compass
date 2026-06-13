# 🌌 Aurora Compass

A single-page web app that helps you **find the aurora in the sky** — like a stargazing app, but for the northern lights. Built for a family Rockies trip; works anywhere in the northern hemisphere.

**Use it:** https://kaiwong-sapiens.github.io/aurora-compass/ → open in Safari/Chrome on your phone → **Start** → allow location + motion → Share → **Add to Home Screen** for the full-screen app feel.

## What it shows

- **Live space weather** (NOAA SWPC): 1-minute estimated **Kp**, and solar-wind **Bz** + speed from the **DSCOVR** satellite at L1 — which sees gusts **~15–45 min before they hit Earth** (shown as "L1 lead", with the measurement time and computed Earth-arrival in your local clock). Kp refreshes every 60 s, solar wind every 60 s, the oval every 5 min, clouds every 30 min, the Kp forecast every 3 h.
- **Where to look**: the current **OVATION aurora oval** (NOAA nowcast) is reduced to a bearing + elevation for *your* position. A **compass dial** (with calibration guidance) and a **sky-dome** view show the band; rotate/tilt/band-edge prompts guide your phone onto it.
- **Clouds**: hourly low/mid/high cloud cover for your exact spot (Open-Meteo) with a "clearest dark-hours window" hint. Pale = cloud, dark = clear.
- **3-hourly Kp forecast** in your local time, with a continuous **day→night background gradient** computed from the real sun position (the dark stretch is your viewing window), G1–G5 storm labels, and threshold lines at Kp 4 (reaches Jasper) and Kp 5 (storm).
- **Verdict**: one line combining darkness (sun elevation), oval strength over your longitude, and cloud — GO / POSSIBLE OVERHEAD / MARGINAL / FAINT / QUIET / TOO FAR NORTH / CLOUDED OUT / DAYLIGHT. The compass shows the band's direction whenever the oval is at all present (faint included).
- **Tap-to-explain (ⓘ)** on every stat and panel.
- **Night mode** (red) to protect dark adaptation — also holds the screen awake for the vigil.

## Works offline

After one online open, a **service worker** caches the app shell so it launches with no signal, and the last good NOAA/cloud data (including the oval grid) is kept in `localStorage` so the dashboard isn't blank at the lakeside. An offline banner shows the data's age; the compass / sky position / tilt keep working (all computed on-device). The app **self-updates**: it checks a version stamp on open and reloads when a new build ships.

## Privacy

No backend, no analytics, no accounts. Your location is used **on-device only** to do the geometry; the app calls public NOAA / Open-Meteo APIs directly from your phone.

## Notes & honest limits

- iOS requires a tap to grant compass access (`DeviceOrientationEvent.requestPermission`) — hence the Start button. HTTPS required (GitHub Pages provides it).
- Compass uses the iPhone's true-north heading directly (no declination guesswork); a manual "compass correction" field (default 0) is there if you ever need a fixed nudge. A wrong/flipped heading is almost always an **uncalibrated magnetometer** or **magnetic interference** (the car, a MagSafe/magnetic case) — wave a slow figure-8 and step clear.
- Aurora altitude is taken as ~110–300 km for elevation math; the oval-edge distance drives how low on the horizon the band sits.
- At high-summer latitudes (~53°N) the sky never reaches full astronomical darkness — expect a low green glow, not overhead curtains, unless Kp is high. The forecast gradient never goes fully black there, which is true to life.
- Kp is defined in 3-hour blocks, so 3-hourly is the finest a Kp *forecast* gets; for sub-hour timing watch the live Bz / L1-lead. OVATION is a model nowcast; substorms can still surprise in either direction.

## Stack

Vanilla HTML/CSS/JS, zero dependencies, one canvas each for compass / sky dome / cloud strip / Kp chart, plus a service worker. Pure geometry/parsing functions are `module.exports`-ed for Node testing. MIT licence.
