# UGM Timer

Fullscreen countdown timer for tablets, with optional presenter/admin
peer-to-peer pairing. Static site, no backend, no build step, no auth.

Hosted on GitHub Pages from `main` / root.

## Features

- Fullscreen countdown timer with minute/second entry, presets, start /
  pause / resume / reset, and quick ±30s / ±1m adjust buttons.
- Configurable color thresholds (up to 3) that change the background as
  time runs low (e.g. 15 min → yellow, 5 min → orange, 2 min → red),
  saved in `localStorage`.
- Tablet/kiosk hardening: fullscreen toggle, screen wake lock, idle-hide
  controls, disabled text selection/callouts, unsaved-changes guard.
- Optional peer-to-peer pairing (WebRTC via PeerJS): one device is the
  **presenter** (the timer everyone watches), another can join using a short join code. Works also completely standalone.
- Anyone can send a short message that appears in a reserved band above
  the timer (never covering it), adjust its font size, and dismiss it. Will be displayed for both devices.
- Timer state and settings changes sync automatically between presenter
  and admin.
- Installable as a PWA (works offline as a standalone timer; pairing
  obviously requires network).

## Usage

1. Open the app. It starts as a **presenter** by default — a join code
   is shown in the top-left pill (e.g. `ugm-ab12cd`). This code is
   persisted, so reloading the presenter keeps the same code.
2. Set a duration (tap the timer, or use a preset), then Start.
3. To pair a second device as **admin**: on that device tap
   **Connect**, enter the presenter's code, and connect.
4. Use the gear icon to configure background thresholds, base color,
   and (from the settings dialog) install the app.

## Development

Just open `index.html` in a browser, or serve the folder with any
static file server. A static server (not `file://`) is required to test
the service worker / PWA install flow and to run two tabs against
PeerJS's signaling broker.

```sh
npx serve .
```

## Deployment

Hosted via GitHub Pages from `main` / root — no build step. Push to
`main` and Pages redeploys automatically. `.nojekyll` is present so
Pages serves files as-is.

## Notes / limitations

- Peer-to-peer pairing uses the public PeerJS Cloud signaling broker
  (loaded from a CDN); an internet connection is required for pairing,
  even though both devices may be in the same room.
- iPadOS Safari has stricter fullscreen and wake-lock support than
  Chrome on Android; the app degrades gracefully (timer still runs
  correctly, just without OS-level fullscreen/wake-lock guarantees).
- Presenter is the single source of truth for timer state; if the
  presenter device is closed, admins keep their last known state but
  cannot control the timer until the presenter comes back.

## Status

See `TASKS.md` for the implementation plan. All tasks (T0–T11) are
implemented.
