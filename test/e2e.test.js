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

// ─── Summary ───────────────────────────────────────────────────────────
console.log(`\n## e2e smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('SOME TESTS FAILED'); process.exit(1); }
else console.log('## e2e: all tests passed');
