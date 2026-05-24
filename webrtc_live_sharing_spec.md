# Live Checklist Sharing via WebRTC — Specification (GitHub Pages / Serverless)

## 1. Overview

A fully **client-side, serverless** live sharing implementation. No backend, no signaling server, no database. All WebRTC negotiation happens via **manual SDP exchange** — both the Shareable Live URL and the Acceptance Token are self-contained blobs carrying the full WebRTC offer/answer payloads.

The app is hosted on **GitHub Pages** (static files only). All state lives in the browser.

---

## 2. Roles

| Role | Description |
|---|---|
| **Initiator (User A)** | Generates the Shareable Live URL (contains the SDP Offer), waits for the Acceptance Token (SDP Answer) from the Acceptor, and finalizes the connection. |
| **Acceptor (User B)** | Opens the Shareable Live URL, which auto-generates an SDP Answer and displays it as the Acceptance Token to share back with the Initiator. |

---

## 3. Signaling Strategy — Manual SDP Exchange

Since there is **no server**, signaling is done entirely out-of-band:

```
User A                                          User B
  │                                               │
  │  Creates RTCPeerConnection                    │
  │  Generates SDP Offer + ICE candidates         │
  │  Compresses + base64-encodes → URL param      │
  │                                               │
  │──── Shares URL (chat, email, etc.) ──────────►│
  │                                               │
  │                         Opens URL in browser  │
  │                         Decodes SDP Offer     │
  │                         Creates RTCPeerConnection
  │                         Sets remote description (Offer)
  │                         Generates SDP Answer + ICE
  │                         Compresses + base64 → Acceptance Token
  │                         Icon turns Yellow     │
  │                                               │
  │◄─── Shares Token (chat, email, etc.) ─────────│
  │                                               │
  │  Pastes Acceptance Token                      │
  │  Decodes SDP Answer                           │
  │  Sets remote description (Answer)             │
  │  ICE negotiation completes ◄══════════════════►
  │                                               │
  │  Icon → Green                  Icon → Green   │
  │◄══════════ P2P DataChannel open ══════════════►│
```

> **ICE Candidates:** Because there is no live signaling channel, ICE candidates must be **gathered in full before encoding** (i.e., wait for `icegatheringstatechange` → `"complete"`). This is known as the **non-trickle ICE** approach. Both the URL and Acceptance Token are only generated after gathering is complete.

---

## 4. Payload Encoding

Both the Shareable Live URL and Acceptance Token carry a **self-contained JSON blob**:

```json
{
  "checklist": {
    "title": "...",
    "items": [{ "id": "uuid", "text": "...", "checked": false }]
  },
  "sdp": "v=0\r\no=- ...\r\n..."
}
```

**Encoding pipeline:**
```
JSON → UTF-8 → DeflateRaw (CompressionStream) → base64url → URL param / token string
```

**Decoding pipeline:**
```
base64url → DeflateRaw (DecompressionStream) → UTF-8 → JSON.parse()
```

> Use the native browser `CompressionStream` / `DecompressionStream` APIs — no libraries needed. A typical small checklist SDP payload compresses to **~1–2 KB**, which fits comfortably in a URL and is easily copy-pasteable as a token.

### 4.1 Shareable Live URL Structure

```
https://<user>.github.io/<repo>/?share=<base64url-encoded-payload>
```

### 4.2 Acceptance Token Structure

A standalone base64url string, displayed in a monospace text box. Not a URL.

---

## 5. The Share Icon & States

A new icon: **a filled circle inside a larger circle**. Always visible on the checklist view.

| State | Color | Meaning |
|---|---|---|
| `idle` | Gray | No session. Default. |
| `pending` | Yellow | This user has accepted; waiting for Initiator to finalize. Read-only mode active. |
| `connected` | Green | P2P DataChannel open. Live syncing active. |

### 5.1 State Transitions

```
idle ──[A: opens Share Dialog, URL generated]──────────────────► idle (A waits for token)
                                                                        │
                                   [B: opens URL & answer generated]    │
idle (B) ───────────────────────────────────────────────────► pending (B)
                                                                        │
                             [A: pastes token & clicks Connect]         │
idle (A) ───────────────────────────────────────────────────► connected (A)
pending (B) ────────────────────────────────────────────────► connected (B)
                                                                        │
                 [Either user disconnects / rejects / confirms]         │
connected / pending ────────────────────────────────────────► idle (both)
```

---

## 6. Icon Interactions by State

### 6.1 Gray (Idle) — Initiator's Share Dialog

Clicking the icon opens the **Share Dialog**. At this point, the app:

1. Creates an `RTCPeerConnection`
2. Creates a DataChannel
3. Generates an SDP Offer
4. Waits for ICE gathering to complete (`icegatheringstatechange` → `"complete"`)
5. Encodes the full payload (checklist + SDP offer) into the Shareable Live URL

**Dialog contents:**

- A loading indicator while ICE is gathering: *"Generating link…"*
- **Shareable Live URL** — read-only text field, auto-populates once ready, with a **Copy** button.
- **Acceptance Token** — empty text input. The Initiator pastes the token received from the Acceptor here.
- **Connect** button — disabled until a token is pasted and passes structural validation (decodable, contains a valid SDP answer).
- **Cancel** button — closes dialog, tears down the pending `RTCPeerConnection`, no state change.

### 6.2 Yellow (Pending) — Acceptor's Token Panel

When the Acceptor opens the Shareable Live URL, the app automatically:

1. Detects the `?share=` query parameter on load
2. Decodes the checklist data and SDP Offer
3. Loads and renders the checklist in read-only mode immediately
4. Creates an `RTCPeerConnection` and sets the remote description (Offer)
5. Generates an SDP Answer, waits for ICE gathering to complete
6. Encodes the answer into the Acceptance Token
7. Displays the Token Panel and turns the icon Yellow

**Token Panel contents:**

- **Acceptance Token** — read-only monospace text field with the full base64url string, with a **Copy** button.
- **Reject** button — confirms: *"Are you sure you want to cancel?"* If confirmed: tears down the connection, clears the `?share=` URL param, icon → Gray, checklist → editable.
- **Continue** button — closes the panel, icon stays Yellow.

### 6.3 Green (Connected) — Session Dialog

Clicking the icon opens the **Session Dialog**:

- **Disconnect** button — confirms: *"Are you sure? Both users will be disconnected."* If confirmed: closes the DataChannel, icon → Gray for both peers, checklist → editable.
- **Continue** button — closes dialog, session continues.

---

## 7. Session Behavior

### 7.1 Read-Only Mode

- **User B (Acceptor):** Read-only from the moment the Shareable Live URL is opened (Yellow state onward).
- **User A (Initiator):** Read-only from the moment the connection becomes Green.
- Applies to: checking/unchecking, adding, removing, renaming, and reordering items.

### 7.2 Real-Time Sync

All synchronization happens exclusively over the **WebRTC DataChannel**. No server is involved at any point after the initial URL share.

Only check/uncheck events are transmitted:

```json
{ "type": "item_toggle", "item_id": "uuid", "checked": true, "ts": 1748000000000 }
```

- Events are applied immediately to the local UI on receipt.
- Conflict resolution: **last-write-wins** by `ts` (millisecond Unix timestamp).

### 7.3 Disconnection

Disconnection is detected via:
- `RTCPeerConnection.onconnectionstatechange` → `"disconnected"` or `"failed"`
- DataChannel `onclose` event

On disconnection:
- Both peers reset independently to Gray (idle).
- Checklist returns to fully editable mode.
- **Last synced state is preserved** — no rollback occurs.

---

## 8. Edge Cases & Constraints

| Scenario | Behavior |
|---|---|
| User B opens the URL but never shares the token | Session stays pending on B's side only; User A is unaffected (still idle). |
| User A closes the Share Dialog before B opens the link | The URL remains valid — it is self-contained. A's `RTCPeerConnection` is torn down locally. A must re-open the dialog to generate a new URL. |
| Browser tab closed during `pending` or `connected` | The other peer detects closure via DataChannel `onclose` and resets to Gray. |
| Large checklist inflating the URL | `CompressionStream` handles most cases. If the encoded URL still exceeds ~8 KB, display an error: *"This checklist is too large to share live."* |
| Symmetric NAT / restrictive firewall | WebRTC ICE may fail. Since no TURN server is available, the connection cannot be established. Display: *"Connection failed. Your network may not support direct peer connections."* |
| User A pastes an invalid or malformed token | The **Connect** button remains disabled, or an inline validation error is shown beneath the input. |
| User A pastes their own URL payload instead of the token | Validation detects an Offer where an Answer is expected and shows an inline error. |
| Both users on different checklists accidentally | Each session is scoped to the payload embedded in the URL. Mismatched checklists will simply display different data — no special handling needed. |

---

## 9. No-Server Constraints Summary

| Concern | Resolution |
|---|---|
| Signaling | Manual SDP copy-paste via Shareable Live URL and Acceptance Token |
| STUN | Use public STUN servers (e.g. `stun:stun.l.google.com:19302`) — no cost, no setup required |
| TURN | **Not available.** Direct P2P only. This is a known limitation and should be documented for users. |
| Persistence | None — the session exists only while both browser tabs are open. |
| Authentication | None — possession of the URL and token is sufficient to establish a session. |
| Checklist state after disconnect | Last synced in-memory state is preserved in each peer's local app state. |

---

## 10. Implementation Notes

### 10.1 ICE Server Configuration

```javascript
const peerConnection = new RTCPeerConnection({
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
});
```

### 10.2 Waiting for Full ICE Gathering

```javascript
function waitForIceGathering(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") resolve();
    });
  });
}
```

### 10.3 Payload Encoding

```javascript
async function encodePayload(obj) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const compressed = await new Response(cs.readable).arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(compressed)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function decodePayload(encoded) {
  const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const decompressed = await new Response(ds.readable).arrayBuffer();
  return JSON.parse(new TextDecoder().decode(decompressed));
}
```

### 10.4 DataChannel Message Handler

```javascript
dataChannel.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "item_toggle") {
    applyToggle(msg.item_id, msg.checked, msg.ts);
  }
};

function sendToggle(item_id, checked) {
  const msg = JSON.stringify({
    type: "item_toggle",
    item_id,
    checked,
    ts: Date.now()
  });
  dataChannel.send(msg);
}
```

### 10.5 Disconnect Handling

```javascript
peerConnection.onconnectionstatechange = () => {
  if (["disconnected", "failed", "closed"].includes(peerConnection.connectionState)) {
    resetSession();
  }
};

dataChannel.onclose = () => resetSession();

function resetSession() {
  peerConnection.close();
  setIconState("idle");
  setChecklistEditable(true);
}
```
