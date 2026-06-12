# 🌌 Aurora Compass

A single-page web app that helps you **find the aurora in the sky** — like a stargazing app, but for the northern lights. Built for a family Rockies trip; works anywhere in the northern hemisphere.

**Use it:** https://kaiwong-sapiens.github.io/aurora-compass/ → open in Safari/Chrome on your phone → **Start** → allow location + motion → Share → **Add to Home Screen** for the full-screen app feel.

## What it shows

- **Live space weather** (NOAA SWPC, refreshed every minute): 1-min estimated Kp, solar-wind **Bz** and speed from the DSCOVR satellite at L1 — which sees gusts **~15–45 min before they hit Earth** (shown as "L1 lead").
- **Where to look**: the current **OVATION aurora oval** (NOAA's nowcast model, ~5-min updates) is reduced to a bearing + elevation for *your* position — a compass dial and a sky-dome view show the band; turn/tilt prompts guide your phone onto it.
- **Clouds**: hourly low/mid/high cloud cover for your exact spot (Open-Meteo) with a "next clear break" hint.
- **Verdict**: one line combining darkness (sun elevation), oval strength over your longitude, and cloud — GO / MARGINAL / QUIET / CLOUDED OUT / DAYLIGHT.
- **Night mode** (red) to protect dark adaptation.

## Privacy

No backend, no analytics, no accounts. Your location is used **on-device only** to do the geometry; the app calls public NOAA/Open-Meteo APIs directly from your phone.

## Notes & honest limits

- iOS requires a tap to grant compass access (`DeviceOrientationEvent.requestPermission`) — hence the Start button. HTTPS required, which GitHub Pages provides.
- Compass uses magnetic heading + an editable declination correction (auto-guessed by region; ~+13°E in the Canadian Rockies).
- Aurora altitude is taken as ~110–300 km for elevation math; the oval-edge distance drives how low on the horizon the band sits.
- At high-summer latitudes (~53°N) the sky never reaches full astronomical darkness — expect a low green glow, not overhead curtains, unless Kp is high.
- OVATION is a model nowcast; substorms can still surprise in either direction.

## Stack

Vanilla HTML/CSS/JS, zero dependencies, one canvas each for compass / sky dome / cloud strip. MIT licence.
