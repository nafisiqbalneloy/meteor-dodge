# METEOR DODGE

A free, no-signup space arcade game that runs entirely in the browser. Pilot a neon spaceship, dodge falling meteors, grab stars, and survive as long as you can.

## Features

- Smooth ship movement, 3 lives, brief invulnerability after a hit
- Meteors in 3 sizes and 3 looks (rock, ice, magma) with varying speeds
- Ship cannon: small meteors take 1 hit, medium 2, large 3 (+10 / +20 / +30 points)
- Bonus stars (+50) and a 6-second shield power-up
- Difficulty that ramps up every 15 seconds, plus Easy / Normal / Hard modes
- Gentle first few seconds so new players can learn the controls
- Particles, screen shake, damage flash, animated score, high-score celebration
- Pause / resume / restart, animated menu and game-over screens
- Original sound effects generated with the Web Audio API (sound toggle, no autoplay)
- Best score saved in the browser (LocalStorage)
- Works on desktop, tablet and phone, portrait or landscape
- Share button (Web Share API, falls back to copying the link)
- No backend, no tracking, no external requests, no dependencies

## Controls

| Action | Desktop | Mobile |
| --- | --- | --- |
| Move | Left / Right arrows or A / D | Drag a finger, or use the optional on-screen pads |
| Shoot | Space (hold to auto-fire) | Auto-fires while dragging, or the FIRE pad |
| Start / restart | Space (on menu / game-over) | Play Now / Play Again |
| Pause / resume | Esc | Pause button |

## Technology

HTML5, CSS3, vanilla JavaScript, Canvas 2D, Web Audio API, LocalStorage.

## Project structure

```
meteor-dodge/
├── index.html        the page and all screens
├── style.css         styling
├── game.js           game logic, rendering, audio, input
├── 404.html          custom not-found page
├── og-image.png      1200x630 social preview image
├── netlify.toml      Netlify config (headers, caching)
├── README.md
└── assets/
    ├── favicon.svg
    └── og-source.html   source used to render og-image.png (not needed in production)
```

## Run locally

Option 1: double-click `index.html`.

Option 2 (recommended, behaves like a real server):

```
cd meteor-dodge
python -m http.server 8080
```

Then open http://localhost:8080.

## Publish with Netlify

### Option A: drag and drop (fastest, about 2 minutes)

1. Go to https://app.netlify.com/ and sign in or create a free account.
2. Open **Projects** (or **Sites**) and choose **Add new project > Deploy manually**.
3. Drag the whole `meteor-dodge` folder onto the upload area.
4. Wait a few seconds for the deploy to finish.
5. Netlify shows your public URL (something like `https://random-name.netlify.app`). You can rename it under **Project configuration > Change project name**.

### Option B: GitHub + Netlify (auto-updates)

1. Create a new repository on GitHub.
2. Upload the contents of the `meteor-dodge` folder to it (so `index.html` is at the repository root).
3. In Netlify choose **Add new project > Import an existing project** and connect GitHub.
4. Select the repository. Leave the build command empty and set the publish directory to `.` (already set in `netlify.toml`).
5. Click **Deploy**.
6. From now on, every `git push` to the main branch redeploys the game automatically.

## Update the game after publishing

- Drag and drop: open the project's **Deploys** tab and drop the updated folder onto it.
- GitHub: commit and push your changes. Netlify redeploys on its own.

## Social sharing preview (important)

Facebook, WhatsApp, Messenger and Discord need an **absolute** image URL for rich previews. The page currently references `og-image.png` relatively, because the real URL is unknown until you deploy. After you get your Netlify URL, edit `index.html` and change both image tags (and optionally add `og:url`):

```html
<meta property="og:image" content="https://YOUR-SITE.netlify.app/og-image.png">
<meta name="twitter:image" content="https://YOUR-SITE.netlify.app/og-image.png">
<meta property="og:url" content="https://YOUR-SITE.netlify.app/">
```

Then redeploy. Platforms cache previews, so use the Facebook Sharing Debugger to refresh Facebook's copy.

## Sharing with friends

Send the Netlify link in any chat or post. In the game, the **Share** button opens the phone's share sheet, or copies the link on desktop.

## Privacy

No accounts, no analytics, no cookies, no third-party requests. The only stored data is your best score, sound, difficulty and touch-pad preference, kept in your own browser.
