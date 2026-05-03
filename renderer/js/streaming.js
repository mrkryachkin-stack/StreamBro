// StreamBro — Streaming Utilities Module
// Helper functions for stream status, platform URLs, encoding settings.
// Loaded before app.js; app.js can use window.SBStreaming.*

window.SBStreaming = (() => {
  'use strict';

  const PLATFORM_URLS = {
    twitch:  'rtmp://live.twitch.tv/app',
    youtube: 'rtmp://a.rtmp.youtube.com/live2',
    kick:    'rtmps://fa723fc1b171.global-contribute.live-video.net:443/app',
  };

  const ALLOWED_ENCODERS = ['libx264', 'h264_nvenc', 'h264_amf', 'h264_qsv'];

  function getPlatformUrl(platform, customUrl) {
    return PLATFORM_URLS[platform] || customUrl || '';
  }

  function safeEncoder(enc) {
    return ALLOWED_ENCODERS.includes(enc) ? enc : 'libx264';
  }

  function formatBitrate(kbps) {
    if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
    return `${kbps} kbps`;
  }

  function parseResolution(res) {
    const [w, h] = String(res).split('x').map(Number);
    return { w: w || 1280, h: h || 720 };
  }

  // Auto-fix AWS IVS / Kick URLs — mirrors the logic in app.js startStream()
  function autoFixCustomUrl(url) {
    if (!url) return url;
    if ((url.includes('live-video.net') || url.includes('twitch-ingest')) && !url.includes(':443')) {
      url = url.replace(/(:443)?\/app$/, ':443/app');
      if (!url.includes(':443')) url += ':443/app';
    }
    return url;
  }

  return {
    PLATFORM_URLS,
    ALLOWED_ENCODERS,
    getPlatformUrl,
    safeEncoder,
    formatBitrate,
    parseResolution,
    autoFixCustomUrl,
  };
})();
