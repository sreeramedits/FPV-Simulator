# FPV Simulator

Browser FPV drone sim (Three.js). Needs to be served over http (models are fetched), e.g.:

    cd dist && npx serve .        # or: python3 -m http.server 8080

Then open the printed URL. Plug in your radio in USB-joystick mode, press Tab, and use the
"Radio / gamepad setup" Assign buttons (move each stick when asked). Keyboard fallback works too.

Keys: Tab settings · C camera (FPV/Chase/Tracker) · R reset · Space arm/disarm · H hide HUD
Keyboard flying: W/S throttle, A/D yaw, arrows pitch/roll.

Swap models: replace dist/models/drone.glb and map.glb (spawn point: SPAWN in src/main.js, or ?sx=&sz=&sy=deg).
