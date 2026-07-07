# Checkify

A hobby project I built to manage my personal checklists — grocery runs, task lists, recipes, packing lists, anything I need to keep track of. Nested lists, encrypted into a URL, shareable with anyone — no account, no server, no tracking.

---

## About

This started as a personal tool because I wanted something simple to help me when I go grocery shopping, work through a to-do list, save a recipe, or plan a trip — without signing up for an app or worrying about my data sitting on someone else's server.

The technical side was just an excuse to experiment with how much you can cram into a URL — compressing and encrypting structured data entirely in the browser and stashing it in the fragment. Turned out to be a fun rabbit hole.

**Features:**
- Two-level structure: top-level items and one level of children, with per-parent and global progress tracking
- Public sharing (no password) or password-protected (AES-128-GCM)
- Title-gated editing — items are locked until a title is set
- Explicit Save workflow — URL only updates when you choose to save
- Checkbox state updates the URL in real-time so shared progress stays current
- New Checklist button — resets to a blank list from any mode, with a confirmation guard when work would be lost
- Works offline after first load
- Live sharing — real-time P2P sync via WebRTC DataChannel; no server after connection, copy-paste signaling, works across different networks
- Dark terminal UI — icon-only buttons on mobile, full labels on desktop

---

## How it works

When you click **Save**, the following pipeline runs entirely in the browser:

```
nodes + title
  → flat text  (depth + type + label per node, joined by \x1F)
  → compressed (deflate-raw via CompressionStream — skipped if it makes it larger)
  → encrypted  (AES-128-GCM, key derived via PBKDF2 from your passphrase)
  → base64url  → window.location.hash
```

Public lists skip the encryption step. The type byte at position 0 of the payload tells the decoder which path to take on load.

---

## App flow

### Creating a checklist
1. Go to `/app` — starts in **EDITING** mode (orange badge)
2. Enter a title — items are locked until the title is filled in
3. Build your list using the tree editor
4. Click **SAVE** — encodes everything into the URL and switches to **RUNNING** mode

### Running mode
- Green **RUNNING** badge
- Only checkboxes are interactive — checking an item updates the URL immediately
- Click **EDIT** (orange) to make structural changes
- Click **NEW** (blue) to start a fresh checklist — confirms first if the current list has content
- Click **SHARE** to copy the link or toggle public/password-protected

### Editing an existing list
1. Click **EDIT** (orange) — enters EDITING mode, SHARE is disabled during editing
2. Modify title, labels, structure
3. Click **SAVE** to commit, or **CANCEL** (red) to discard changes

### Sharing
- **Public** — anyone with the link can open it, no password required
- **Protected** — recipient is prompted for the passphrase you set; encrypted with AES-128-GCM

### Live sharing

Live sharing lets two people check/uncheck items in real time via a direct peer-to-peer connection. No server is involved once the connection is established.

**To start a session (initiator):**
1. Save a checklist and enter RUNNING mode
2. Click **LIVE** — the button appears in the header in running mode
3. Wait a few seconds while the shareable Live URL is generated
4. Copy the URL (or use **SHARE URL…** on mobile) and send it to the other person — each link works only once; don't generate a new one after they've opened it
5. Wait for them to paste their **Acceptance Token** back into the dialog
6. Click **CONNECT** — the LIVE button turns green when connected

**To join a session (acceptor):**
1. Open the Live URL — the checklist loads automatically
2. Wait for the **Acceptance Token** to appear (a few seconds)
3. Copy the token (or use **SHARE TOKEN…** on mobile) and send it to the initiator
4. **Keep the tab open and your screen on until connected** — see the note below
5. Once the initiator connects, your LIVE button turns green
6. Click **REJECT** at any time before connecting to decline

> **On mobile, stay in the tab while the session is pending.** Android suspends background and locked-screen tabs, which silently kills the half-open connection — the initiator's CONNECT will then always time out. The app holds a screen wake lock during the pending phase so your screen won't turn off by itself, but switching to another app for more than a moment can still break the handshake. Send the token, then come straight back.

While connected, checking or unchecking any item syncs to the other user instantly. Either person can disconnect by clicking the green LIVE button → **DISCONNECT**.

The connection uses WebRTC DataChannel. Signaling (the initial handshake) is done entirely by copy-pasting two short tokens — no WebSocket server or relay is needed for signaling. STUN and a TURN relay server are used for NAT traversal, so it works across different networks, behind CGNAT, and on the same LAN.

---

## Running locally

Requires Docker — no Ruby or Node needed on your machine.

```bash
git clone <repo-url>
cd checkify
docker compose up --build   # first run (builds image, installs gems)
docker compose up           # subsequent runs
```

Visit **http://localhost:4000/checkify/**

> Note: the trailing slash is required locally. On the live site both `streetcoder.dev/checkify` and `streetcoder.dev/checkify/` work.

LiveReload is enabled — changes to HTML, CSS, and JS reload the browser automatically.

```bash
# Rebuild after editing Gemfile
docker compose up --build

# Stop the server
docker compose down
```

---

## Project structure

| Path | Purpose |
|------|---------|
| `index.html` | Landing page |
| `app/index.html` | Checklist builder (EDITING + RUNNING modes) |
| `assets/js/codec.js` | Serialization, compression, encryption — pure, no DOM |
| `assets/js/tree.js` | Node state machine and DOM rendering |
| `assets/js/app.js` | UI orchestration, mode transitions, event wiring |
| `assets/js/live.js` | WebRTC live sharing — peer connection lifecycle, SDP serialization, DataChannel messaging |
| `assets/css/style.css` | All styles (design tokens, dark theme, components) |
| `test/codec.test.js` | Unit tests for the encode/decode pipeline |
| `Dockerfile` | Jekyll 4.2 dev image |
| `docker-compose.yml` | Dev server (port 4000) + test runner (profile: test) |
| `_config.yml` | Jekyll config — `baseurl` set to `/checkify` for GitHub Pages |
| `.github/workflows/test.yml` | CI — runs codec tests on every push/PR |

---

## Keyboard shortcuts

These work in the tree editor while in EDITING mode:

| Key | Action |
|-----|--------|
| `Enter` | New sibling node below current |
| `Tab` | Indent (make child of node above) |
| `Shift+Tab` | Unindent |
| `Backspace` | Delete node when label is empty (minimum 1 node kept) |
| `-` | Toggle branch (section ↔ task) when label is empty |
| `Escape` | Close share panel |

---

## Deploying to GitHub Pages

1. In `_config.yml`, set `baseurl` to match your repo name:
   ```yaml
   baseurl: "/checkify"
   ```
   Leave it as `""` for a root-level deployment (`username.github.io`).

2. Push to `main`.

3. In repo **Settings → Pages**, set source to branch `main`, folder `/`.

GitHub Pages runs Jekyll automatically. The `_site/` build output is excluded from the repo via `.gitignore`.

> **Note:** `crypto.subtle` (used for encryption) requires HTTPS or `localhost`. GitHub Pages always uses HTTPS, so it works out of the box.

---

## Running tests

Tests cover the full encode/decode pipeline in `codec.js` — serialization, compression, encryption, and decryption. 29 tests across 5 suites, zero external dependencies. CI runs them automatically on every push via GitHub Actions.

**With Docker (no local Node needed):**
```bash
docker compose --profile test run --rm node-test
```

**With local Node 18+:**
```bash
node --test test/codec.test.js
```

---

## Tech stack

- **Jekyll 4** — static site generator, served via GitHub Pages
- **Vanilla JS ES modules** — no bundler, no framework, no npm
- **Web Crypto API** — AES-GCM encryption and PBKDF2 key derivation
- **CompressionStream API** — deflate-raw compression, browser-native
- **WebRTC DataChannel** — peer-to-peer real-time sync; STUN (Google) + TURN (Open Relay) for NAT traversal
- **Screen Wake Lock + Web Share APIs** — keep pending live sessions alive on mobile and hand off links/tokens via the OS share sheet
- **Docker** — local dev via `jekyll/jekyll:4.2.2`; Node 20 Alpine for tests
- **GitHub Actions** — CI for codec unit tests

---

## Contributing

This is a personal project, but PRs are welcome for bugs or genuine improvements.

A few rules:

- **No external dependencies.** `codec.js`, `tree.js`, and `app.js` import nothing from npm or CDNs.
- **`codec.js` is DOM-free.** Pure data/crypto module — no `document`, no `window`.
- **`tree.js` owns node state.** Use the exported functions; don't touch the internal `nodes` array from `app.js`.
- **`app.js` owns mode state.** `APP_MODE` is `'editing'` or `'running'` — transitions go through `enterEditingMode()` / `enterRunningMode()`.
- **Verify the round-trip before submitting:**
  ```js
  // Run in browser console at localhost:4000/checkify/app/
  const { encodePublic, decodeFromHash } = await import('/checkify/assets/js/codec.js');
  const nodes = [{ id: '1', depth: 0, type: ' ', label: 'Item' }];
  const hash = await encodePublic(nodes, 'My List');
  const back = await decodeFromHash(hash, null);
  console.assert(back.title === 'My List');
  console.assert(back.nodes[0].label === 'Item');
  console.log('round-trip OK');
  ```
- **Keep the aesthetic.** Dark terminal theme, monospace font, teal/orange/green/red accent palette. Use existing CSS custom properties from `style.css`.

---

## License

MIT
