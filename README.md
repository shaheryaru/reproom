# RepRoom: Gym & Calorie Tracker

A phone-first web app (PWA) for logging workouts and calories. No account, no server:
everything is saved in your phone's browser (localStorage) and works offline once installed.

## Features
- **Workout log**: exercises, sets, reps, weight (kg or lb), notes, edit / repeat / delete past workouts
- **Food log**: add, edit, and delete calories and protein per food, meals, quick-add and recent foods, any past day
- **Daily calorie goal** with a progress ring, plus a calculator (Mifflin–St Jeor, gentle surplus/deficit, 1,800 kcal floor for under-18s)
- **Summary**: day view (calories, protein, sets, volume, top sets) and 7-day view (calorie chart vs goal, workouts, volume trend, most-trained exercises)
- **Backup**: export / import a JSON file (Settings)

## Files
| File | What it does |
|---|---|
| `index.html` | Page shell, header, bottom tabs |
| `styles.css` | All styling. Colours are at the top in `:root` |
| `app.js` | All the logic. Each screen has a `viewX()` (HTML) and `bind.x` (buttons) function |
| `sw.js` | Offline cache. **Bump `VERSION` every time you change a file** so phones get the update |
| `manifest.webmanifest` | App name, icon and colours for "Add to Home Screen" |
| `icons/` | App icons |

Easy first edits: the `EXERCISES` and `QUICK_FOODS` lists near the top of `app.js`, or the colours in `styles.css`.

## Run it on your computer
Open the folder in VS Code and run `python3 -m http.server 8000` (or use the "Live Server" extension),
then open http://localhost:8000. (Opening index.html directly works too, but offline mode needs a server.)

## Check
```
npm install
npm test
```
The tests cover food add, edit, and delete, daily totals, and the offline app shell under a `/reproom/` base path (the GitHub Pages project URL). The manifest scope and service worker are relative to the folder the site is served from, so the same files also work at a domain root.

## Deploy
Drag this folder onto https://app.netlify.com/drop, or in your Netlify site go to **Deploys → drag and drop**.
If the folder is in GitHub, connect the repo in Netlify (**Add new site → Import from Git**) and every commit deploys automatically.
