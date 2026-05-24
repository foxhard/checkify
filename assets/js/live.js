// ── Base64url helpers ─────────────────────────────────────

function _toBase64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function _fromBase64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4 !== 0) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Payload codec (JSON → DeflateRaw → base64url) ────────

const _MAX_DECOMP = 5 * 1024 * 1024;

export async function encodePayload(obj) {
  const input = new TextEncoder().encode(JSON.stringify(obj));
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();
  const chunks = [];
  writer.write(input);
  writer.close();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return _toBase64url(out);
}

export async function decodePayload(str) {
  const bytes = _fromBase64url(str);
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  writer.write(bytes);
  writer.close();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > _MAX_DECOMP) throw new Error('Payload exceeds size limit');
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return JSON.parse(new TextDecoder().decode(out));
}

// ── Module state ──────────────────────────────────────────

let _pc             = null;
let _dc             = null;
let _role           = null;  // 'initiator' | 'acceptor'
let _state          = 'idle'; // 'idle' | 'offer_pending' | 'answer_pending' | 'connected'
let _connectTimeout = null;
let _callbacks = { onConnected: null, onMessage: null, onDisconnect: null, onError: null };
const _lastApplied = new Map(); // item_id → ts (LWW conflict resolution)

const strSettings = "HFa013bDaqa0SiJp5IICZAbNIGXQhGnoRZesSR8plXpKJpxcpkITwqr9-hmIKedkq2ZlVErfnLlOsO0OAzYifBib8DHcPGZMMZV1LOBL9kzOh-aqukMyA85LjFI-w6v_hfGZJP4vcBP6o70BHFP-farGrK02q5j92ns6UuRWnV-Kml05QhgHdPZknsysfM0eTsGCi6krd0auNV9ncSdbnDDAiipy1N0NGa0cqHVdQa51ZLvUj6fVYwhjl8TUFM5ZE_j4dZqQNcltoDxcWf5KHbvBIKLhZ0P6ZTCR3H727Avi05tMRdrAiRG0_w8_iQ0MIyYjF5VT82-Otgf-TrxKlppdm7twxa3hl8suHTKzEmYEtP5v3nXp27m8Hgg-vrci6YWUjWP_8AqrDw9Lu4wzedraJJe6rU8vNQonm-nK8lhFdiGqWL11raZAUe1FjKgT4duF1I5xZHJTlZECHdKPZxjfOuRhVgWJVPWDX_xTJnfNH0CCSVpQQdHpjoxclHATd97netwTvIIKOj8RvJ22QF32K1j917r0QF1eJDpw9ZDQN6sRtUODdheyyyyB9fo_Fx4Pjx2jvUYSoI732QdJHuSbfCf1oYqjDa4bJ6HgfN8UhD-29SCGKaqZpzuxwkJmA1sls8bBfIEH7tbXdJ2iXA2rR7b9hvqGQLpJhKg3HbipHQU8oHyXeJ1DOzmdcmaovJvjEYHOMIqJk3q7QIiIym4gs5bUK2EegvZHWEedhNsUGVEkrgk46c8NSBwNOER85QmNeRECXF73FAO9CTy3BQy7r_q5NHLn7feVh2tT_tUuqtV4ixusybF1-aluc7jl6_UTAaqvJvmJ1eHdv1CYTmTEdhQJUJcO_z2U4RQleAVrWYwM7zqRjQosTDJ1759KKGb69Gi_W1TQqG6MsDqTi5y0_Hw8dnGehW1Cvqt2CrcHexN7sz9ki_d6koCdU6cBJhuuP_au6Z6IHtAFnpIufMzcRBC_vfvB4gDsLGtD37OX94N8_Faag0K4dePhlA-XVwtPCwlSxWBspjGOcmcv3Xyba-MPOabjC31T6AvnHu0_enT01O8M_G5xq2A8P8kexJnwbfPv6xy_gbQfWK-6tnqX3EadO3xLEkFgbf1fwUam-FWxKB5sCSe_iAo2qDmef7ido4gUwUAEVjEh9tzjIdpaV5NcpNa5oJEC4T27uELUCDZ56ne5GDGbtuGj56Q6Mg-LmFpBUumfik4YbE6I6caX71wrOXv9Z2qRRU2wSTSPrlmUGdw33F-PKOLdACOSk1I1V-os_gYF6rjIt2V8biBrQGceqd26E7FkXucHu3_Ql1Fhi8Lw8HFTkJayeBLeP2Rf4ANwVu8j563EROKmZQG7oaR5v04FAEw88Ap6mMRlHyAxVCZFPXe277DBa3vjNagyLCS2sO35D3dpmFkawbTNwXywy0TPIMVPiEn5I-osKUcogHtZfejMxWxYtd9Jxmdg1NBC4JzDPLNGEIzAV0F5Sg0nVoKMXIhttuJI2CGhUZCicv2Jz_8Z9ET8shaLE2q605fk5fFsOhtex0sUXKSnSMkCuSSDwmIkd3M5NggdzyAp1J0D1zj0ML8xHs67o9Ns-EabOEHhEZBkMyQofvbhKb8f0gXo_fbvNTlGNo4XQIsNBYkmRtu4NmihFz3SAivNfLtyG-w-9U8RVA4RMwvJ3fs2wzV0i_xm1Lkn7GntPfzxU2Eo0sRHcNKaHSkJeqW3_dxn3HF6pcpWL6UMoeMxTelaS-_Yu9pGzufl66cqVrE8D1rhQVhoCC-fUjg9a59S763tLwzCCiM65dSSWqRDCIWliVa7O4uLQ5PuBDai6ue6BCpywNY8MH2lz5Ym_UvvfJaacYgAGTF5zoYQZOMZRKZ4MmbdjUaK3pI7NDiA571nX2I1hyHwWx7v9xIVWp4iKS-Wbi83xQJM";

async function getConfigFrom(blob) {
  const enc  = new TextEncoder();
  const pass = await crypto.subtle.importKey(
    'raw', enc.encode('ohqtUhdnLYM6BQxZ3HJ*jH*hceEgidePfmc6VjuTjXRDMj6YxcC'),
    'PBKDF2', false, ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('mb7NJ-DraThbFAeLUTGKA3HMf2x_gnYdbNGxPUMT3eUTRRei6*wBGhiDXZH.uLgHXx'), iterations: 10000, hash: 'SHA-256' },
    pass, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );
  const bytes = _fromBase64url(blob);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  return JSON.parse(new TextDecoder().decode(plain)).iceConfig;
}

let _iceConfig = null;
async function _getIceConfig() {
  if (_iceConfig) return _iceConfig;
  _iceConfig = await getConfigFrom(strSettings);
  return _iceConfig;
}

const _URL_SIZE_LIMIT = 8192;

// ── Callbacks ─────────────────────────────────────────────

export function setLiveCallbacks({ onConnected, onMessage, onDisconnect, onError }) {
  _callbacks = { onConnected, onMessage, onDisconnect, onError };
}

// ── Internal helpers ──────────────────────────────────────

function _waitForIce(pc) {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') return resolve();
    let done = false;
    let silenceTimer  = null;
    let hasUsefulCand = false; // true once we see at least one srflx or relay

    const finish = (reason) => {
      if (done) return;
      done = true;
      clearTimeout(silenceTimer);
      clearTimeout(hardTimer);
      clearTimeout(mdnsOnlyTimer);
      pc.removeEventListener('icegatheringstatechange', onState);
      pc.removeEventListener('icecandidate', onCandidate);
      console.log(_ts(), '[live] ICE gathering done:', reason);
      resolve();
    };

    // 20s hard cap — only fires if no candidates ever arrive
    const hardTimer = setTimeout(() => finish('hard timeout (20s)'), 20000);

    // If STUN/TURN never responds (e.g. Safari on localhost), give up after 8s
    // so we don't spin forever with only mDNS. The passive acceptor approach keeps
    // mDNS registered even if only mDNS is gathered.
    const mdnsOnlyTimer = setTimeout(() => {
      if (!hasUsefulCand) finish('8s mDNS-only fallback');
    }, 8000);

    function onState() {
      if (pc.iceGatheringState === 'complete') finish('state complete');
    }

    function onCandidate(e) {
      if (e.candidate === null) { finish('null sentinel'); return; }

      if (e.candidate.type === 'srflx' || e.candidate.type === 'relay') {
        hasUsefulCand = true;
      }

      // Only run the 3s silence window once we have at least one srflx/relay.
      // Before that we wait — STUN/TURN may still be in flight.
      if (hasUsefulCand) {
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => finish('3s silence after srflx/relay'), 3000);
      }
    }

    pc.addEventListener('icegatheringstatechange', onState);
    pc.addEventListener('icecandidate', onCandidate);
  });
}

function _resetState(notify = false) {
  if (_state === 'idle') return;
  clearTimeout(_connectTimeout);
  _connectTimeout = null;
  _state = 'idle';
  _role  = null;
  _lastApplied.clear();
  if (notify) _callbacks.onDisconnect?.();
}

function _wireDataChannel() {
  const pc = _pc;
  console.log('[live] _wireDataChannel: wiring dc, readyState=', _dc.readyState);
  _dc.onopen = () => {
    console.log(_ts(), '[live] DataChannel opened');
    clearTimeout(_connectTimeout);
    _connectTimeout = null;
    _state = 'connected';
    _callbacks.onConnected?.();
  };
  _dc.onclose = () => {
    console.log(_ts(), '[live] DataChannel closed');
    _dc = null;
    const pc = _pc;
    _pc = null;
    try { pc?.close(); } catch {}
    _resetState(true);
  };
  _dc.onmessage = e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type !== 'item_toggle') return;
    const prev = _lastApplied.get(msg.item_id) ?? -1;
    if (msg.ts > prev) {
      _lastApplied.set(msg.item_id, msg.ts);
      _callbacks.onMessage?.(msg);
    }
  };
  _dc.onerror = () => {
    console.error('[live] DataChannel error');
    _callbacks.onError?.('CHANNEL_ERROR');
    _dc = null;
    _pc = null;
    try { pc?.close(); } catch {}
    _resetState(false);
  };
}

async function _dumpIceStats(pc) {
  try {
    const stats = await pc.getStats();
    const cands = {};
    stats.forEach(s => {
      if (s.type === 'local-candidate' || s.type === 'remote-candidate') cands[s.id] = s;
    });
    let pairs = 0;
    stats.forEach(s => {
      if (s.type !== 'candidate-pair') return;
      pairs++;
      const l = cands[s.localCandidateId], r = cands[s.remoteCandidateId];
      console.log('[live] pair', s.state, 'nominated=' + !!s.nominated,
        '| local', l?.candidateType, l?.protocol, (l?.address ?? l?.ip ?? '?') + ':' + (l?.port ?? '?'),
        '| remote', r?.candidateType, r?.protocol, (r?.address ?? r?.ip ?? '?') + ':' + (r?.port ?? '?'),
        '| reqSent=' + (s.requestsSent ?? '?'), 'respRecv=' + (s.responsesReceived ?? '?'));
    });
    if (!pairs) console.log('[live] no candidate pairs were formed');
  } catch (e) { console.warn('[live] getStats failed:', e); }
}

const _t0 = Date.now();
function _ts() { return '+' + ((Date.now() - _t0) / 1000).toFixed(1) + 's'; }

function _wireConnectionState(pc) {
  pc.oniceconnectionstatechange = () => {
    console.log(_ts(), '[live] ICE connection state:', pc.iceConnectionState);
  };
  pc.onconnectionstatechange = () => {
    console.log(_ts(), '[live] Connection state:', pc.connectionState);
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      // If the initiator takes long to paste the answer token, the acceptor's
      // checks can time out and ICE reports failed. Keep the PC alive — its
      // ports stay open, and the connection revives when the initiator
      // finalizes and connectivity checks resume.
      if (_state === 'answer_pending' && _role === 'acceptor') {
        console.log('[live] ICE failed in acceptor answer_pending — keeping session, waiting for initiator');
        _dumpIceStats(pc);
        return;
      }
      const wasConnecting = _state === 'answer_pending';
      _dc = null;
      _pc = null;
      // Dump pair stats before closing — getStats returns nothing on a closed PC.
      _dumpIceStats(pc).finally(() => { try { pc.close(); } catch {} });
      if (wasConnecting) {
        _callbacks.onError?.('CONNECTION_FAILED');
        _resetState(false);
      } else {
        _resetState(true);
      }
    }
  };
}

// ── SDP compact serialization ─────────────────────────────
// Transmit only the variable fields (credentials, fingerprint, candidates)
// and reconstruct a valid minimal SDP on the receiving end.
// The fingerprint hex (95 chars with colons) is stored as 32 raw bytes →
// base64url (43 chars), and SDP boilerplate is rebuilt from a template.

function _sdpToData(sdp) {
  const lines = sdp.split('\r\n');
  const get = prefix => {
    const l = lines.find(l => l.startsWith(prefix));
    return l ? l.slice(prefix.length) : '';
  };
  const fpHex = get('a=fingerprint:sha-256 ');
  const fpBytes = new Uint8Array(fpHex.split(':').map(h => parseInt(h, 16)));
  const candidates = lines
    .filter(l => l.startsWith('a=candidate:'))
    .map(l => l.slice('a=candidate:'.length));
  return {
    u: get('a=ice-ufrag:'),
    p: get('a=ice-pwd:'),
    f: _toBase64url(fpBytes),
    s: get('a=setup:'),
    c: candidates,
  };
}

function _dataToSdp(data) {
  const fpBytes = _fromBase64url(data.f);
  const fp = Array.from(fpBytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  return [
    'v=0',
    'o=- 1 1 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=ice-options:trickle',
    `a=ice-ufrag:${data.u}`,
    `a=ice-pwd:${data.p}`,
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${data.s}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    ...data.c.map(c => `a=candidate:${c}`),
    // An empty candidate list combined with end-of-candidates puts the ICE
    // agent in a terminal failed state — only claim it when candidates exist.
    ...(data.c.length ? ['a=end-of-candidates'] : []),
  ].join('\r\n') + '\r\n';
}

// ── Public API ────────────────────────────────────────────

export async function createOffer(checklistData) {
  closeSession();
  _pc = new RTCPeerConnection(await _getIceConfig());
  _wireConnectionState(_pc);
  _dc = _pc.createDataChannel('live', { ordered: true });
  _wireDataChannel();

  const offer = await _pc.createOffer();
  await _pc.setLocalDescription(offer);
  console.log('[live] Waiting for ICE gathering (offer)…');
  await _waitForIce(_pc);
  const offerCandidates = _pc.localDescription.sdp.split('\r\n').filter(l => l.startsWith('a=candidate'));
  console.log('[live] ICE gathering complete (offer), candidates:', offerCandidates.length);
  offerCandidates.forEach(c => console.log('[live] offer cand:', c));

  const encoded = await encodePayload({ checklist: checklistData, sdp: _sdpToData(_pc.localDescription.sdp) });
  if (encoded.length > _URL_SIZE_LIMIT) {
    closeSession();
    throw new Error('TOO_LARGE');
  }

  _role  = 'initiator';
  _state = 'offer_pending';
  return encoded;
}

export async function finalizeConnection(answerToken) {
  if (!_pc) throw new Error('No active session');
  const payload = await decodePayload(answerToken);
  if (!payload || !payload.sdp) throw new Error('INVALID_TOKEN');

  // Ensure local gathering is complete — Chrome defers ICE checks otherwise.
  if (_pc.iceGatheringState !== 'complete') {
    console.log('[live] finalizeConnection: waiting for local gathering to settle...');
    await _waitForIce(_pc);
  }
  if (!_pc) throw new Error('Session closed during gathering wait');

  // Answer SDP with the acceptor's candidates embedded — setting it gives the
  // ICE agent the full remote candidate set and starts connectivity checks.
  const sdpData = typeof payload.sdp === 'object' ? payload.sdp : null;
  const answerSdp = sdpData ? _dataToSdp(sdpData) : payload.sdp;
  const remoteCands = sdpData?.c ?? [];
  console.log('[live] Remote answer candidates:', remoteCands.length);
  remoteCands.forEach(c => console.log('[live] remote cand:', c));
  console.log(_ts(), '[live] finalizeConnection: setting remote description (answer)');
  try {
    await _pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  } catch (e) {
    console.error('[live] setRemoteDescription failed:', e);
    throw new Error('NOT_AN_ANSWER');
  }

  console.log('[live] Remote description set, pc state:', _pc.signalingState, '| iceState:', _pc.iceConnectionState);
  _state = 'answer_pending';

  const pc = _pc;
  _connectTimeout = setTimeout(async () => {
    if (_state !== 'answer_pending') return;
    console.warn(_ts(), '[live] Connection timeout — DataChannel did not open within 30s');
    await _dumpIceStats(pc);
    if (_state !== 'answer_pending') return; // connected while dumping stats
    _callbacks.onError?.('CONNECTION_FAILED');
    _dc = null;
    _pc = null;
    try { pc?.close(); } catch {}
    _resetState(false);
  }, 30000);
}

export async function createAnswer(offerSdpOrData) {
  closeSession();

  const offerData = typeof offerSdpOrData === 'object' ? offerSdpOrData : null;
  // Offer SDP with the initiator's candidates embedded. The acceptor must know
  // them to send its own connectivity checks — that's what opens its NAT
  // pinhole and installs TURN permissions for the initiator's addresses.
  // The initiator's tab is alive waiting for the answer token, so it responds
  // to these early checks; ICE can establish before finalizeConnection runs,
  // and DTLS completes once the initiator sets the answer.
  const offerSdp = offerData ? _dataToSdp(offerData) : offerSdpOrData;
  if (!offerSdp) throw new Error('INVALID_OFFER');

  // Set role/state before any await so _wireConnectionState can recognize the
  // acceptor if ICE fails mid-gathering and keep the session alive.
  _role  = 'acceptor';
  _state = 'answer_pending';

  try {
    _pc = new RTCPeerConnection(await _getIceConfig());
    _wireConnectionState(_pc);
    _pc.ondatachannel = e => {
      console.log('[live] ondatachannel fired, channel label:', e.channel.label);
      _dc = e.channel;
      _wireDataChannel();
    };

    await _pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });

    const answer = await _pc.createAnswer();
    await _pc.setLocalDescription(answer);
    console.log('[live] Waiting for ICE gathering (answer)…');
    await _waitForIce(_pc);
    if (!_pc) throw new Error('Session closed during gathering');
    const answerCandidates = _pc.localDescription.sdp.split('\r\n').filter(l => l.startsWith('a=candidate'));
    console.log('[live] ICE gathering complete (answer), candidates:', answerCandidates.length);
    answerCandidates.forEach(c => console.log('[live] answer cand:', c));

    const encoded = await encodePayload({ sdp: _sdpToData(_pc.localDescription.sdp) });
    return { answerToken: encoded };
  } catch (e) {
    closeSession();
    throw e;
  }
}

export function sendToggle(itemId, checked) {
  if (!_dc || _dc.readyState !== 'open') return;
  const ts = Date.now();
  _lastApplied.set(itemId, ts);
  _dc.send(JSON.stringify({ type: 'item_toggle', item_id: itemId, checked, ts }));
}

export function closeSession() {
  if (_dc) { try { _dc.close(); } catch {} _dc = null; }
  if (_pc) { try { _pc.close(); } catch {} _pc = null; }
  _resetState(false);
}

export function getState() { return _state; }
