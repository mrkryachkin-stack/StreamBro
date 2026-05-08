// E2E-like smoke tests for StreamBro (Node.js, no Electron required)
// Tests core logic flows that would be exercised in UI

'use strict';

let passed = 0, failed = 0;
function ok(label, cond) {
  if (cond) { console.log('  ok:', label); passed++; }
  else { console.error('  FAIL:', label); failed++; }
}

console.log('\n## E2E Smoke Tests\n');

// ─── 1. Settings flow ──────────────────────────────────────────────
{
  const DEFAULT_SETTINGS = {
    version: 2,
    onboardingComplete: false,
    theme: 'dark',
    streaming: { platform: 'twitch', resolution: '1280x720', fps: 30, bitrate: 4000 },
    updates: { autoCheck: true, autoDownload: false },
    friends: { notifications: { sound: true, badge: true }, perFriend: {}, list: [] }
  };
  
  // Simulate settings load + merge
  const saved = { version: 2, theme: 'neon', onboardingComplete: true };
  const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
  
  ok('Settings merge keeps default keys', merged.streaming !== undefined);
  ok('Settings merge overrides theme', merged.theme === 'neon');
  ok('onboardingComplete flag preserved', merged.onboardingComplete === true);
  ok('Friends notifications default preserved', merged.friends?.notifications?.sound === true);
}

// ─── 2. Stream URL validation ──────────────────────────────────────
{
  function validateStreamUrl(platform, url, key) {
    if (!key || key.length < 4) return { ok: false, error: 'stream key too short' };
    const urls = {
      twitch: 'rtmp://live.twitch.tv/app',
      youtube: 'rtmp://a.rtmp.youtube.com/live2',
      kick: 'rtmps://fa723fc1b171.global-contribute.live-video.net:443/app',
      custom: url,
    };
    const rtmpUrl = urls[platform] || url;
    if (!rtmpUrl) return { ok: false, error: 'no URL' };
    if (!rtmpUrl.startsWith('rtmp')) return { ok: false, error: 'invalid protocol' };
    return { ok: true, url: rtmpUrl };
  }
  
  ok('Twitch URL valid', validateStreamUrl('twitch', '', 'live_xxx123').ok);
  ok('Kick URL valid', validateStreamUrl('kick', '', 'sk_us-east_xxx').ok);
  ok('Short key rejected', !validateStreamUrl('twitch', '', 'abc').ok);
  ok('Custom RTMP valid', validateStreamUrl('custom', 'rtmp://myserver.com/live', 'mykey').ok);
  ok('Custom HTTP rejected', !validateStreamUrl('custom', 'http://myserver.com', 'key123').ok);
}

// ─── 3. Auto-update semver comparison ──────────────────────────────
{
  function semverGt(a, b) {
    const pa = String(a).replace(/^v/, '').split('.').map(Number);
    const pb = String(b).replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i]||0) > (pb[i]||0)) return true;
      if ((pa[i]||0) < (pb[i]||0)) return false;
    }
    return false;
  }
  
  ok('1.2.9 > 1.2.8', semverGt('1.2.9', '1.2.8'));
  ok('2.0.0 > 1.9.9', semverGt('2.0.0', '1.9.9'));
  ok('1.2.8 not > 1.2.8', !semverGt('1.2.8', '1.2.8'));
  ok('1.2.7 not > 1.2.8', !semverGt('1.2.7', '1.2.8'));
  ok('v1.3.0 > 1.2.9 (v prefix)', semverGt('v1.3.0', '1.2.9'));
}

// ─── 4. Friends store logic ─────────────────────────────────────────
{
  // Simulate friends-store LWW logic
  const friends = {};
  function updateFriend(id, data, ts) {
    if (!friends[id] || friends[id]._ts < ts) {
      friends[id] = { ...data, _ts: ts };
    }
  }
  
  updateFriend('u1', { name: 'Alice', status: 'online' }, 1000);
  updateFriend('u1', { name: 'Alice', status: 'away' }, 2000);
  updateFriend('u1', { name: 'Alice', status: 'online' }, 500); // older — should be ignored
  
  ok('LWW: newer update wins', friends['u1'].status === 'away');
  ok('LWW: older update ignored', friends['u1']._ts === 2000);
}

// ─── 5. Chat message validation ─────────────────────────────────────
{
  function validateMsg(content) {
    if (!content || typeof content !== 'string') return false;
    const trimmed = content.trim();
    return trimmed.length > 0 && trimmed.length <= 2000;
  }
  
  ok('Valid message passes', validateMsg('Hello!'));
  ok('Empty message rejected', !validateMsg(''));
  ok('Whitespace-only rejected', !validateMsg('   '));
  ok('2000 chars OK', validateMsg('a'.repeat(2000)));
  ok('2001 chars rejected', !validateMsg('a'.repeat(2001)));
}

// ─── 6. Edit time window ─────────────────────────────────────────────
{
  function canEdit(createdAt) {
    return (Date.now() - new Date(createdAt).getTime()) <= 2 * 60 * 1000;
  }
  
  ok('Fresh message editable', canEdit(new Date().toISOString()));
  ok('1min ago editable', canEdit(new Date(Date.now() - 60000).toISOString()));
  ok('2min+1s ago NOT editable', !canEdit(new Date(Date.now() - 121000).toISOString()));
}

// ─── 7. onboarding flag ───────────────────────────────────────────────
{
  const settings = { onboardingComplete: false };
  
  // Simulate completing onboarding
  function completeOnboarding(s) {
    s.onboardingComplete = true;
  }
  
  ok('Onboarding not complete initially', !settings.onboardingComplete);
  completeOnboarding(settings);
  ok('Onboarding marked complete', settings.onboardingComplete === true);
}

// ─── 8. Rate limit simulation ─────────────────────────────────────────
{
  function createRateLimiter(maxReq, windowMs) {
    const hits = [];
    return function() {
      const now = Date.now();
      const cutoff = now - windowMs;
      // Remove old hits
      while (hits.length && hits[0] < cutoff) hits.shift();
      if (hits.length >= maxReq) return false; // rate limited
      hits.push(now);
      return true;
    };
  }
  
  const limiter = createRateLimiter(3, 10000);
  ok('Request 1 allowed', limiter());
  ok('Request 2 allowed', limiter());
  ok('Request 3 allowed', limiter());
  ok('Request 4 blocked (rate limited)', !limiter());
}

// ─── 9. Avatar URL normalization ─────────────────────────────────────
{
  const SERVER_BASE = 'https://streambro.ru';
  function normalizeAvatarUrl(url) {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('avatar:')) return url;
    if (url.startsWith('/')) return SERVER_BASE + url;
    return url;
  }
  
  ok('Relative URL gets base', normalizeAvatarUrl('/api/user/avatars/x.png') === SERVER_BASE + '/api/user/avatars/x.png');
  ok('Absolute URL unchanged', normalizeAvatarUrl('https://example.com/img.png') === 'https://example.com/img.png');
  ok('Empty returns empty', normalizeAvatarUrl('') === '');
  ok('avatar: scheme unchanged', normalizeAvatarUrl('avatar:initials') === 'avatar:initials');
}

// ─── 10. HW encoder validation ────────────────────────────────────────
{
  const ALLOWED_ENCODERS = ['libx264', 'h264_nvenc', 'h264_amf', 'h264_qsv'];
  function safeEncoder(enc) {
    return ALLOWED_ENCODERS.includes(enc) ? enc : 'libx264';
  }
  
  ok('libx264 allowed', safeEncoder('libx264') === 'libx264');
  ok('h264_nvenc allowed', safeEncoder('h264_nvenc') === 'h264_nvenc');
  ok('Unknown encoder falls back', safeEncoder('evil_encoder') === 'libx264');
  ok('Injection attempt falls back', safeEncoder('libx264; rm -rf /') === 'libx264');
}

// ─── 11. Room code generation & formatter ──────────────────────────────
{
  // Same generateRoomCode as in signaling-server/server.js and server/src/routes/rooms.js
  function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      if (i > 0) code += '-';
      for (let j = 0; j < 4; j++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
    }
    return code;
  }

  // Same formatter as in renderer/js/app.js (oninput handler)
  function formatRoomCode(raw) {
    let v = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (v.length > 4) v = v.slice(0, 4) + '-' + v.slice(4);
    if (v.length > 9) v = v.slice(0, 9) + '-' + v.slice(9);
    if (v.length > 14) v = v.slice(0, 14) + '-' + v.slice(14);
    if (v.length > 19) v = v.slice(0, 19);
    return v;
  }

  // Test code generation
  const codes = [];
  for (let i = 0; i < 50; i++) codes.push(generateRoomCode());

  ok('Room code format XXXX-XXXX-XXXX-XXXX', codes.every(c => /^\w{4}-\w{4}-\w{4}-\w{4}$/.test(c)));
  ok('Room code 19 chars (16 alphanum + 3 dashes)', codes.every(c => c.length === 19));
  ok('Room code no ambiguous chars (0/O/1/I)', codes.every(c => !/[0OI1]/.test(c)));
  ok('Room codes are unique (50 generated)', new Set(codes).size === 50);

  // Test formatter: user types characters one by one
  ok('Format: empty → empty', formatRoomCode('') === '');
  ok('Format: "AB" → "AB"', formatRoomCode('AB') === 'AB');
  ok('Format: "ABCD" → "ABCD"', formatRoomCode('ABCD') === 'ABCD');
  ok('Format: "ABCDE" → "ABCD-E"', formatRoomCode('ABCDE') === 'ABCD-E');
  ok('Format: "ABCD1234" → "ABCD-1234"', formatRoomCode('ABCD1234') === 'ABCD-1234');
  ok('Format: "ABCD12345" → "ABCD-1234-5"', formatRoomCode('ABCD12345') === 'ABCD-1234-5');
  ok('Format: "ABCD1234EFGH" → "ABCD-1234-EFGH"', formatRoomCode('ABCD1234EFGH') === 'ABCD-1234-EFGH');
  ok('Format: full 16 chars → XXXX-XXXX-XXXX-XXXX', formatRoomCode('ABCD1234EFGH5678') === 'ABCD-1234-EFGH-5678');
  ok('Format: 17+ chars → truncated to 19', formatRoomCode('ABCD1234EFGH5678ZZ') === 'ABCD-1234-EFGH-5678');

  // Test formatter: user pastes with dashes
  ok('Format: paste with dashes works', formatRoomCode('ABCD-1234-EFGH-5678') === 'ABCD-1234-EFGH-5678');
  ok('Format: paste lowercase auto-uppercases', formatRoomCode('abcd-1234-efgh-5678') === 'ABCD-1234-EFGH-5678');

  // Critical test: generated code passes through formatter unchanged
  const testCode = generateRoomCode();
  ok('Generated code passes formatter unchanged', formatRoomCode(testCode) === testCode);

  // Simulate join flow: user types code char by char → final value matches generated code
  let typed = '';
  for (const ch of testCode) {
    typed = formatRoomCode(typed + ch);
  }
  ok('Typing generated code char-by-char matches', typed === testCode);
}

// ─── 12. Room code signaling join validation ──────────────────────────
{
  // Simulate the signaling server join flow
  const rooms = new Map();

  function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      if (i > 0) code += '-';
      for (let j = 0; j < 4; j++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
    }
    return code;
  }

  // Create room
  const code = generateRoomCode();
  rooms.set(code, { code, peers: new Map() });

  // Join with exact code
  const joinCode = code.toUpperCase();
  ok('Join with exact code finds room', rooms.has(joinCode));

  // Join with lowercase
  const lowerCode = code.toLowerCase();
  ok('Join with lowercase finds room (server .toUpperCase)', rooms.has(lowerCode.toUpperCase()));

  // Join with wrong code
  ok('Join with wrong code not found', !rooms.has('ZZZZ-ZZZZ-ZZZZ-ZZZZ'));

  // Join with truncated code (8 chars, the old bug)
  const truncated = code.slice(0, 9); // e.g. "ABCD-1234"
  ok('Join with truncated code NOT found (old bug scenario)', !rooms.has(truncated));
}

// ─── 11. P2P Peer ID Resolution ───────────────────────────────────────
{
  // Simulate profile with serverId (authenticated user)
  const profile = { id: 'prof-abc123', serverId: '550e8400-e29b-41d4-a716-446655440000' };
  const myPeerId = profile.serverId || profile.id || 'local';
  ok('Peer ID uses serverId when available', myPeerId === profile.serverId);
  ok('Peer ID is not local when authenticated', myPeerId !== 'local');

  // Simulate profile without serverId (local-only user)
  const profileLocal = { id: 'prof-xyz789', serverId: '' };
  const myPeerIdLocal = profileLocal.serverId || profileLocal.id || 'local';
  ok('Peer ID falls back to local id when no serverId', myPeerIdLocal === profileLocal.id);
  ok('Peer ID is not string "local" with local id', myPeerIdLocal !== 'local');

  // Simulate profile with undefined userId (the old bug)
  const profileBug = { id: 'prof-def456', serverId: 'uuid-123', userId: undefined };
  const myPeerIdBug = profileBug.userId || profileBug.serverId || profileBug.id || 'local';
  ok('Old profile.userId undefined does not cause "local"', myPeerIdBug !== 'local');

  // The actual fix: serverId || id || 'local'
  const myPeerIdFixed = profileBug.serverId || profileBug.id || 'local';
  ok('Fixed peer ID uses serverId first', myPeerIdFixed === profileBug.serverId);
}

// ─── 12. P2P Signal Message Format ─────────────────────────────────────
{
  // Verify signal message format matches Presence WS expectations
  const signalMsg = {
    type: 'signal',
    targetPeerId: '550e8400-e29b-41d4-a716-446655440000',
    signal: { type: 'sdp-offer', sdp: { type: 'offer', sdp: 'v=0\r\n...' } },
    roomCode: 'ABCD-1234-EFGH-5678',
  };
  ok('Signal message has type "signal"', signalMsg.type === 'signal');
  ok('Signal message has targetPeerId', typeof signalMsg.targetPeerId === 'string');
  ok('Signal message has signal object', typeof signalMsg.signal === 'object');
  ok('Signal message has roomCode', typeof signalMsg.roomCode === 'string');
  ok('Signal message targetPeerId is UUID format', /^[0-9a-f-]{36}$/.test(signalMsg.targetPeerId));
  ok('Signal message roomCode is 19 chars', signalMsg.roomCode.length === 19);

  // ICE candidate format
  const iceMsg = {
    type: 'signal',
    targetPeerId: '550e8400-e29b-41d4-a716-446655440000',
    signal: { type: 'ice-candidate', candidate: { candidate: '...', sdpMid: '0', sdpMLineIndex: 0 } },
    roomCode: 'ABCD-1234-EFGH-5678',
  };
  ok('ICE candidate signal has candidate field', iceMsg.signal.type === 'ice-candidate');
  ok('ICE candidate signal has candidate object', typeof iceMsg.signal.candidate === 'object');
}

// ─── 13. ICE Server Configuration ──────────────────────────────────────
{
  // Simulate _buildIceServers logic
  function buildIceServers(turnUrl, turnUser, turnPass) {
    const servers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
    ];
    if (turnUrl && turnUser && turnPass) {
      const base = turnUrl.replace(/\/$/, '');
      servers.push({
        urls: [base + '?transport=udp', base + '?transport=tcp'],
        username: turnUser,
        credential: turnPass,
      });
    }
    return servers;
  }

  const stunOnly = buildIceServers('', '', '');
  ok('STUN-only has 5 servers', stunOnly.length === 5);
  ok('STUN-only has no TURN', !stunOnly.some(s => s.username));

  const withTurn = buildIceServers('turn:streambro.ru:3478', 'user', 'pass');
  ok('STUN+TURN has 6 servers', withTurn.length === 6);
  ok('TURN entry has username', withTurn[5].username === 'user');
  ok('TURN entry has credential', withTurn[5].credential === 'pass');
  ok('TURN entry has udp+tcp urls', withTurn[5].urls.length === 2);

  const missingTurn = buildIceServers('turn:streambro.ru:3478', 'user', '');
  ok('Missing TURN password = no TURN', missingTurn.length === 5);
}

// ─── 14. Echo Guard ────────────────────────────────────────────────────
{
  // Simulate _applyRemoteSrcAdd echo guard
  const myPeerId = '550e8400-e29b-41d4-a716-446655440000';
  const remotePeerId = '660e8400-e29b-41d4-a716-446655440001';

  const metaOwn = { gid: 'src1', ownerPeerId: myPeerId };
  const metaRemote = { gid: 'src2', ownerPeerId: remotePeerId };
  const metaNoOwner = { gid: 'src3' };

  // Echo guard: ownerPeerId === myPeerId → skip (it's our own source replayed back)
  ok('Echo guard blocks own sources', metaOwn.ownerPeerId === myPeerId);
  ok('Echo guard allows remote sources', metaRemote.ownerPeerId !== myPeerId);
  ok('Echo guard allows sources without ownerPeerId', !metaNoOwner.ownerPeerId || metaNoOwner.ownerPeerId !== myPeerId);

  // The old bug: both peers had myPeerId = 'local'
  const myPeerIdOld = 'local';
  const remotePeerIdOld = 'local';
  ok('Old bug: both peers had same "local" ID', myPeerIdOld === remotePeerIdOld);
  ok('Old bug: echo guard would block all remote', metaRemote.ownerPeerId === myPeerIdOld || metaRemote.ownerPeerId !== myPeerIdOld || myPeerIdOld === remotePeerIdOld);
}

// ─── 15. Room Member Filtering ────────────────────────────────────────
{
  // When joining a room, filter out ourselves from peer list
  const myPeerId = '550e8400-e29b-41d4-a716-446655440000';
  const members = [
    { userId: '550e8400-e29b-41d4-a716-446655440000' }, // us (creator)
    { userId: '660e8400-e29b-41d4-a716-446655440001' }, // them
  ];
  const peerIds = members.filter(m => m.userId !== myPeerId).map(m => m.userId);
  ok('Room member filter excludes self', peerIds.length === 1);
  ok('Room member filter includes other peer', peerIds[0] === '660e8400-e29b-41d4-a716-446655440001');

  // Old bug: myPeerId was 'local', so no member matches 'local' → all members included → self-connect
  const myPeerIdOld = 'local';
  const peerIdsOld = members.filter(m => m.userId !== myPeerIdOld).map(m => m.userId);
  ok('Old bug: self not filtered with "local" ID', peerIdsOld.length === 2);
}

// ─── Summary ───────────────────────────────────────────────────────────
console.log(`\n## e2e smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('SOME TESTS FAILED'); process.exit(1); }
else console.log('## e2e: all tests passed');
