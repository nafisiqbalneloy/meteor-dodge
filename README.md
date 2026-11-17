<p align="center">
  <img src="assets/banner.png" alt="METEOR DODGE" width="720">
</p>

A tiny retro space arcade game. Dodge the meteors, shoot what you can, grab the stars, survive.

**[>> PLAY NOW <<](https://nafisiqbalneloy.github.io/meteor-dodge/)**

Free. No sign-up. Works on PC and phone.

---

## CONTROLS

| | PC | PHONE |
|---|---|---|
| Move | Arrow keys or A / D | Drag your finger |
| Shoot | Space (hold) | Auto-fires while you drag, or the FIRE button |
| Pause | Esc | Pause button |
| Fullscreen | F | Fullscreen button |

## HOW IT WORKS

- You have **3 lives**. A meteor hit costs one.
- **Shoot** meteors to break them. Small ones take 1 hit, medium 2, large 3.
- **Stars** give +50 points.
- **Combo:** shoot meteors one after another to raise your score multiplier (up to x5). Getting hit resets it.
- **UFOs:** small red saucers fly across and shoot at you. Shoot them down for points and a chance at a power-up.
- **Bosses:** every minute or so a big boss drops in. There are 3 kinds: the Magma King throws meteors, the Ice Eye fires fans of bullets, and the Laser Skull shoots beams (watch the red warning line). Beat one for 500 points, three stars and an extra life if you lost one.
- **Ships:** you start with STAR (balanced). Earn the rest: DART (fast, small) by scoring 1500 in one run, TANK (slow, shoots fast) by beating a boss, and VOID (twin shot) by scoring 5000 in one run. Pick one on the menu.
- **Black holes:** from level 4 a black hole sometimes drifts down. It pulls your ship, bends meteors and swallows stars and power-ups. Stay away from the dark centre.
- Retro music plays while you fly. Turn it off with the MUSIC button.
- The game gets faster every 15 seconds.
- **Level themes:** every 3 levels the sky changes: Deep Space, Ice Field, Lava Zone, Toxic Nebula. The meteor mix changes with it (more ice meteors in the Ice Field, more magma in the Lava Zone).
- Pick **Easy**, **Normal** or **Hard** on the menu.
- Your best score is saved in your browser.

**Gamepad:** plug one in. Stick or D-pad to move, A / X / triggers to shoot, Start to pause.

**Vibration:** phones that support it buzz on hits and boss fights. Turning SOUND off turns it off too.

**Install it:** use your browser's "Install" or "Add to Home Screen" to play it like an app, even offline.

## POWER-UPS

| ITEM | WHAT IT DOES |
|---|---|
| Cyan **S** orb | Shield for 6 seconds. Meteors can't hurt you. |
| Purple **+** box | Adds a wingman plane. Grab two for a triple ship. Every plane shoots. They vanish after 10 seconds. |
| Orange **R** diamond | Rapid fire. You shoot much faster for 8 seconds. |
| Red **B** diamond | Bomb. Blows up every meteor on screen. |

## RUN IT YOURSELF

No install, no build. Download the files and open `index.html` in a browser.

Or run a small local server:

```
python -m http.server 8080
```

Then go to `http://localhost:8080`.

## BUILT WITH

HTML, CSS, plain JavaScript, Canvas and the Web Audio API. No libraries, no tracking, no outside requests. Sound effects are generated in code.

## FILES

```
index.html   the page and menus
manifest.json app info (install)
sw.js        offline support
style.css    the pixel look
game.js      the game
404.html     not-found page
og-image-v2.png link preview picture
assets/      icon, font and banner
```

## LICENSE

The game code is free to use and change under the MIT License (see `LICENSE`).

## CREDITS

Font: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) by CodeMan38, under the SIL Open Font License (see `assets/OFL.txt`).
