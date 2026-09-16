# UGM Timer — Implementation Tasks

Chronological task list. Each task is shippable/verifiable on its own.

---

## Key decisions

| Topic       | Choice                                                                                | Why                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Structure   | Single `index.html` + native ES modules, no build step                                | GitHub Pages serves static files; native `import` works everywhere we target                                          |
| P2P         | PeerJS via CDN (pinned, ~12 KB gz)                                                    | WebRTC requires a signaling broker. Only realistic zero-backend option. Custom short peer IDs double as the join code |
| Timer       | Timestamp-based (`endsAt`) + `requestAnimationFrame` render                           | `setInterval` drifts and is throttled in background tabs                                                              |
| Topology    | Presenter = host and single source of truth. Admin(s) connect with a code             | App must work standalone without an admin                                                                             |
| Persistence | `localStorage` for settings only (never timer runtime state)                          | Requirement                                                                                                           |
| Settings    | Shared across the pair, presenter-authoritative, last-write-wins by `settingsVersion` | Both sides must see identical thresholds/colors                                                                       |

### Default settings

```js
{
  thresholds: [
    { minutes: 15, color: '#f5c518', enabled: true },  // yellow
    { minutes: 5,  color: '#f28c28', enabled: true },  // orange
    { minutes: 2,  color: '#d02b2b', enabled: true }   // red
  ],
  baseColor: '#101418',
  defaultDurationMs: 30 * 60 * 1000,
  messageFontSize: 5,        // vh
  flashOnZero: true,
  keepAwake: true
}
```

---

## T0 — Repo scaffold + GitHub Pages

Files: `index.html`, `css/app.css`, `js/main.js`, `.nojekyll`, `README.md`

- Enable Pages on `main` / root.
- Verify the deployed URL loads over HTTPS (required for WebRTC and PWA).
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">`

**Done when:** a blank styled page is live at `*.github.io/ugm-timer/`.

---

## T1 — App shell + fullscreen layout

Three vertical zones, CSS grid:

```
+------------------------------+
| message band  (top ~18vh)    |  always reserved, empty when no message
+------------------------------+
| TIMER (centered, huge)       |  fills remaining space
+------------------------------+
| controls bar (bottom)        |  dims/hides after 3s idle
+------------------------------+
```

- `body` fills viewport, `overflow: hidden`, background from CSS var `--bg` with a 400 ms transition.
- Timer font: `font-variant-numeric: tabular-nums`, `font-size: clamp(6rem, 22vw, 28rem)`.
- The message band's space is permanently reserved, so a message can never cover or shift the timer.

**Done when:** a static `00:00` renders full screen and scales correctly in portrait and landscape on the tablet.

---

## T2 — Timer engine (`js/timer.js`)

Pure module, no DOM access.

```js
{
  status: ("idle" | "running" | "paused" | "finished",
    durationMs,
    remainingMs,
    endsAt,
    version);
}
```

API: `setDuration(ms)`, `start()`, `pause()`, `resume()`, `reset()`, `adjust(deltaMs)`, `getRemaining()`, `subscribe(cb)`

- Running: `remaining = endsAt - Date.now()`, clamped at `>= 0`.
- Paused: frozen `remainingMs`.
- `version` increments on every mutation (used for sync conflict resolution in T8).
- Format `MM:SS`, switch to `H:MM:SS` at >= 60 min. Never go negative — stop at `0` and enter `finished`.

**Done when:** the render loop counts down accurately with no visible drift after 10 minutes.

---

## T3 — Primary controls

- Duration entry: separate `MM` and `SS` number fields (or tap the timer to edit). Optional presets: 5 / 10 / 15 / 20 / 30 / 45 min.
- Buttons: **Start / Pause / Resume / Reset**. One primary button toggles start↔pause; Reset is separate and requires a double tap while running.
- Touch targets >= 64 px, no hover-only affordances.
- Keyboard (desktop convenience): `Space` toggles, `R` resets.

**Done when:** the full start → pause → resume → reset cycle works entirely by touch.

---

## T4 — Quick adjust buttons

Four buttons, shown only while `running` or `paused`: `−1:00` `−0:30` `+0:30` `+1:00`

- Shifts `endsAt` while running; shifts `remainingMs` while paused.
- Floors at 0. Brief flash of the new value as feedback.
- Bumps `version` so the change propagates in T8.

---

## T5 — Settings + thresholds (local)

Gear icon opens a modal panel. Persisted under `localStorage` key `ugm-timer:settings:v1` using the defaults above.

- Max 3 threshold rows, each with a minutes input, `<input type="color">`, and an enable/remove toggle.
- Base (normal) background color is also configurable.
- Apply rule: sort thresholds descending by minutes, pick the **lowest** threshold whose `minutes * 60000 >= remaining`; that color wins.
- Auto-pick a readable foreground via relative-luminance check (white or black text).
- Validation: minutes 0–180, no duplicates, enabled rows only.
- "Reset to defaults" button.

**Done when:** background flips exactly at the boundaries and settings survive a reload.

---

## T6 — Tablet / kiosk hardening

- Fullscreen button calling `requestFullscreen()` (needs a user gesture).
- `navigator.wakeLock.request('screen')`, re-acquired on `visibilitychange`.
- Disable text selection, long-press callout, double-tap zoom, and pull-to-refresh (`overscroll-behavior: none`).
- Auto-hide controls after 3 s idle; reveal on tap anywhere.
- `beforeunload` guard while the timer is running.

---

## T7 — P2P foundation (`js/peer.js`)

Load PeerJS from CDN, version pinned, with `integrity` attribute.

- Everyone opens the app as **presenter** by default.
- Presenter generates code `ugm-XXXXXX` (6 chars, ambiguous `0/O/I/1` excluded), registers it as the PeerJS ID, retries on `unavailable-id`. Code is persisted in `localStorage` so a presenter reload keeps the same code.
- Admin flow: "Connect as admin" → enter code → `peer.connect(id)`.
- Presenter accepts N admin connections and tracks the list.
- Connection status pill: `offline / connecting / linked (n)`. Reconnect with backoff; handle `peer.on('disconnected')` → `reconnect()`.
- Admin UI is the presenter UI plus the message compose button.
- App remains fully functional with zero peers.

**Done when:** two devices link via the code, status reads linked, and closing the admin degrades gracefully.

---

## T8 — Timer state sync

Envelope over the data channel:

```js
{ type: 'state',    version, status, remainingMs, endsAt, sentAt }
{ type: 'cmd',      action: 'start'|'pause'|'resume'|'reset'|'adjust'|'setDuration', payload, sentAt }
{ type: 'settings', settingsVersion, settings }          // T8b
{ type: 'hello' }
{ type: 'msg' } / { type: 'msg-dismiss' }                // T9
```

- Presenter is the authority. Admin sends `cmd`; presenter applies it, bumps `version`, broadcasts `state` to everyone.
- Presenter broadcasts on every mutation **plus** a 1 s heartbeat as cheap resync against packet loss.
- Receiver ignores any `state` whose `version` is lower than its local one.
- Never trust a remote `endsAt` (clock skew): recompute locally as `endsAt = Date.now() + remainingMs`.
- On admin connect, presenter immediately sends a full `state` snapshot.

**Done when:** start / pause / reset / ±adjust performed on either device is reflected on both within ~200 ms.

---

## T8b — Settings sync

Settings are shared state, not per-device state.

- Add `settingsVersion` (monotonic integer) to the settings object; bump on every change.
- Admin edits settings → sends `{ type: 'settings', settingsVersion, settings }` to the presenter → presenter applies, re-bumps if needed, and broadcasts to all peers.
- Presenter edits → broadcast directly.
- Receiver applies only if the incoming `settingsVersion` is greater than local (last-write-wins).
- On connect handshake, presenter pushes its current settings; admin adopts them wholesale and writes them to its own `localStorage`.
- A device that has never connected keeps its local settings; the defaults above apply on first run.
- Settings panel reflects remote updates live while open.
- Synced keys: `thresholds`, `baseColor`, `defaultDurationMs`, `messageFontSize`, `flashOnZero`. Device-local only (never synced): `keepAwake`, role, peer code.

**Done when:** changing a threshold color or minute value on the admin instantly repaints the presenter, and vice versa, and both persist after reload.

---

## T9 — Message overlay

Admin-only compose dialog: textarea, `A−` / `A+` font-size steppers (2–10 vh, stored in synced settings), live preview inside the real band, **Send**, **Dismiss**.

- Send broadcasts `{ type: 'msg', text, fontSize }` and renders locally, so the admin sees exactly what the presenter sees and can tell if the text is too long or too large.
- Band is a fixed top region, high contrast (opaque dark panel, bold light text), subtle entry animation. `max-height: 18vh`; deliberately **not** clamped, so overflow is visible to the admin. The timer is never shifted.
- Dismiss broadcasts `{ type: 'msg-dismiss' }` and clears both sides. Sending a new message replaces the old one.
- Optional: 1 s pulse on arrival so the presenter notices.

**Done when:** the message is readable across the room, the timer stays fully visible, and dismissal works both via the button and by sending a replacement.

---

## T10 — PWA

- `manifest.webmanifest`: name, `start_url: "./"`, `scope: "./"`, `display: "fullscreen"`, `orientation: "any"`, `background_color`, `theme_color`, icons 192 / 512 plus maskable.
- `sw.js`: precache the app shell, cache-first for own assets, stale-while-revalidate for the PeerJS CDN. Bump `CACHE_VERSION` on deploy and delete stale caches on `activate`.
- Register with a scope-relative path because of the GitHub Pages subpath: `navigator.serviceWorker.register('./sw.js')`.
- Install prompt: capture `beforeinstallprompt`, expose an "Install" button in settings.
- Offline: the app works fully standalone; P2P obviously still requires network.

**Done when:** Lighthouse PWA audit passes, it installs on the Android tablet, launches fullscreen, and works in airplane mode as a solo timer.

---

## T11 — Polish & QA

- Verify on Chrome for Android tablet, iPadOS Safari (document wake-lock and fullscreen limitations), and desktop Chrome.
- Edge cases: adjusting past 0, tab backgrounded for 10 min, admin joining mid-run, presenter reload (code is persisted), two admins connected simultaneously, settings changed while disconnected then reconnected.
- README: usage, pairing flow, deployment notes.

---

### Milestones

- **T0 – T6** — fully usable standalone timer. Shippable.
- **T7 – T9** — pairing, sync, messaging. Highest-risk chunk.
- **T10 – T11** — installability and hardening.
