"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";

/* ═══════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════ */
type Source = {
  id: string;
  type: "camera" | "screen" | "mic" | "desktop";
  name: string;
  stream: MediaStream | null;
  visible: boolean;
  muted: boolean;
  vol: number;       // 0–1
  x: number;         // canvas position (0–1 normalized)
  y: number;
  w: number;         // normalized width
  h: number;
  locked: boolean;
};

type StreamStatus = "offline" | "connecting" | "live" | "error";

type Platform = "twitch" | "youtube" | "kick" | "custom";

const PLATFORMS: Record<Platform, { label: string; url: string; placeholder: string }> = {
  twitch:  { label: "Twitch",  url: "rtmp://live.twitch.tv/app",          placeholder: "livе_xxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxx" },
  youtube: { label: "YouTube", url: "rtmp://a.rtmp.youtube.com/live2",    placeholder: "xxxx-xxxx-xxxx-xxxx" },
  kick:    { label: "Kick",    url: "rtmps://fa723fc1b171.global-contribute.live-video.net:443/app", placeholder: "sk_us-xxx..." },
  custom:  { label: "Custom",  url: "",                                    placeholder: "rtmp://server/path" },
};

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */
let _sid = 0;
function nextId() { return `src_${++_sid}_${Date.now()}`; }

function getSupportedMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=h264,opus",
    "video/webm",
  ];
  for (const mt of candidates) {
    if (MediaRecorder.isTypeSupported(mt)) return mt;
  }
  return "";
} }

/* ═══════════════════════════════════════════════════════════════
   STUDIO PAGE
   ═══════════════════════════════════════════════════════════════ */
export default function StudioPage() {
  useEffect(() => { document.title = "StreamBro — Студия"; }, []);
  useEffect(() => { document.body.classList.add("studio-body"); return () => { document.body.classList.remove("studio-body"); }; }, []);

  // ─── Auth ───
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/user/test-cookie", { credentials: "include" })
      .then(r => r.json())
      .then(d => setAuthed(!!d.hasCookie))
      .catch(() => setAuthed(false))
      .finally(() => setLoading(false));
  }, []);

  // ─── Sources ───
  const [sources, setSources] = useState<Source[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioNodesRef = useRef<Map<string, { gain: GainNode; analyser: AnalyserNode; sourceNode: MediaStreamAudioSourceNode | null }>>(new Map());
  const animRef = useRef<number>(0);

  // ─── Stream ───
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("offline");
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [streamKey, setStreamKey] = useState("");
  const [relayWs, setRelayWs] = useState<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const combinedStreamRef = useRef<MediaStream | null>(null);

  // ─── Recording ───
  const [recording, setRecording] = useState(false);
  const recordChunksRef = useRef<Blob[]>([]);

  // ─── Canvas size ───
  const [canvasW, setCanvasW] = useState(1920);
  const [canvasH, setCanvasH] = useState(1080);

  // ─── Drag state ───
  const dragRef = useRef<{ srcId: string; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number; mode: "move" | "resize" } | null>(null);

  // ─── Add source ───
  const addSource = useCallback(async (type: "camera" | "screen" | "mic" | "desktop") => {
    let stream: MediaStream | null = null;
    let name = "";

    try {
      if (type === "camera") {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
        name = "Камера";
      } else if (type === "mic") {
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true } });
        name = "Микрофон";
      } else if (type === "screen") {
        const ds = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true });
        stream = ds;
        name = "Экран";
      } else if (type === "desktop") {
        // Desktop audio requires screen capture with audio in browser
        const ds = await navigator.mediaDevices.getDisplayMedia({ video: false, audio: true } as any);
        stream = ds;
        name = "Системный звук";
      }
    } catch (e: any) {
      console.warn("Failed to get media:", e.message);
      return;
    }

    if (!stream) return;

    const id = nextId();
    const isAudioOnly = type === "mic" || type === "desktop";
    const src: Source = {
      id,
      type,
      name,
      stream,
      visible: true,
      muted: false,
      vol: 1,
      x: isAudioOnly ? 0 : 0.1,
      y: isAudioOnly ? 0 : 0.1,
      w: isAudioOnly ? 0 : 0.5,
      h: isAudioOnly ? 0 : 0.5,
      locked: false,
    };

    setSources(prev => [...prev, src]);

    // Create <video> element for video sources
    if (!isAudioOnly && stream.getVideoTracks().length > 0) {
      const vid = document.createElement("video");
      vid.srcObject = stream;
      vid.autoplay = true;
      vid.playsInline = true;
      vid.muted = true;
      vid.style.display = "none";
      document.body.appendChild(vid);
      videoRefs.current.set(id, vid);
    }

    // Connect audio to Web Audio API
    if (stream.getAudioTracks().length > 0) {
      connectAudio(id, stream, type === "mic");
    }
  }, []);

  // ─── Audio setup ───
  const connectAudio = useCallback((srcId: string, stream: MediaStream, isMic: boolean) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext({ sampleRate: 48000 });
    }
    const ctx = audioCtxRef.current;
    const srcNode = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = 1;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    srcNode.connect(gain);
    gain.connect(analyser);
    // Don't connect to destination for local mic (feedback prevention)
    if (!isMic) {
      gain.connect(ctx.destination);
    }
    audioNodesRef.current.set(srcId, { gain, analyser, sourceNode: srcNode });
  }, []);

  // ─── Remove source ───
  const removeSource = useCallback((id: string) => {
    setSources(prev => {
      const src = prev.find(s => s.id === id);
      if (src?.stream) {
        src.stream.getTracks().forEach(t => t.stop());
      }
      const vid = videoRefs.current.get(id);
      if (vid) {
        vid.srcObject = null;
        vid.remove();
        videoRefs.current.delete(id);
      }
      const node = audioNodesRef.current.get(id);
      if (node) {
        node.sourceNode?.disconnect();
        node.gain.disconnect();
        node.analyser.disconnect();
        audioNodesRef.current.delete(id);
      }
      return prev.filter(s => s.id !== id);
    });
    setSelId(prev => prev === id ? null : prev);
  }, []);

  // ─── Toggle mute ───
  const toggleMute = useCallback((id: string) => {
    setSources(prev => prev.map(s => {
      if (s.id !== id) return s;
      const muted = !s.muted;
      const node = audioNodesRef.current.get(id);
      if (node) node.gain.gain.value = muted ? 0 : s.vol;
      return { ...s, muted };
    }));
  }, []);

  // ─── Set volume ───
  const setVol = useCallback((id: string, vol: number) => {
    setSources(prev => prev.map(s => {
      if (s.id !== id) return s;
      const node = audioNodesRef.current.get(id);
      if (node && !s.muted) node.gain.gain.value = vol;
      return { ...s, vol };
    }));
  }, []);

  // ─── Toggle visible ───
  const toggleVisible = useCallback((id: string) => {
    setSources(prev => prev.map(s => s.id === id ? { ...s, visible: !s.visible } : s));
  }, []);

  // ─── Toggle lock ───
  const toggleLock = useCallback((id: string) => {
    setSources(prev => prev.map(s => s.id === id ? { ...s, locked: !s.locked } : s));
  }, []);

  // ─── Render loop ───
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;
    function render() {
      if (!running) return;
      ctx!.fillStyle = "#000";
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);

      // Draw sources (video only)
      sources
        .filter(s => s.visible && s.stream && s.stream.getVideoTracks().length > 0)
        .forEach(s => {
          const vid = videoRefs.current.get(s.id);
          if (!vid || vid.readyState < 2) return;
          const x = s.x * canvas!.width;
          const y = s.y * canvas!.height;
          const w = s.w * canvas!.width;
          const h = s.h * canvas!.height;
          ctx!.drawImage(vid, x, y, w, h);
        });

      // Draw selection border on selected source
      if (selId) {
        const sel = sources.find(s => s.id === selId);
        if (sel && sel.visible) {
          const x = sel.x * canvas!.width;
          const y = sel.y * canvas!.height;
          const w = sel.w * canvas!.width;
          const h = sel.h * canvas!.height;
          ctx!.strokeStyle = "#c9a227";
          ctx!.lineWidth = 2;
          ctx!.strokeRect(x, y, w, h);

          // Resize handles (4 corners)
          const hs = 8;
          ctx!.fillStyle = "#c9a227";
          [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([hx, hy]) => {
            ctx!.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
          });
        }
      }

      animRef.current = requestAnimationFrame(render);
    }
    render();
    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, [sources, selId]);

  // ─── Canvas mouse handlers (drag / resize) ───
  const onCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;

    // Check resize handles first
    if (selId) {
      const sel = sources.find(s => s.id === selId);
      if (sel) {
        const hs = 12 / canvas.width; // handle hit area
        const corners = [
          { cx: sel.x, cy: sel.y, dx: 1, dy: 1 },
          { cx: sel.x + sel.w, cy: sel.y, dx: -1, dy: 1 },
          { cx: sel.x, cy: sel.y + sel.h, dx: 1, dy: -1 },
          { cx: sel.x + sel.w, cy: sel.y + sel.h, dx: -1, dy: -1 },
        ];
        for (const c of corners) {
          if (Math.abs(mx - c.cx) < hs && Math.abs(my - c.cy) < hs) {
            dragRef.current = { srcId: sel.id, startX: mx, startY: my, origX: sel.x, origY: sel.y, origW: sel.w, origH: sel.h, mode: "resize" };
            return;
          }
        }
      }
    }

    // Hit test sources (reverse order = top source first)
    for (let i = sources.length - 1; i >= 0; i--) {
      const s = sources[i];
      if (!s.visible || s.stream?.getVideoTracks().length === 0) continue;
      if (mx >= s.x && mx <= s.x + s.w && my >= s.y && my <= s.y + s.h) {
        setSelId(s.id);
        if (!s.locked) {
          dragRef.current = { srcId: s.id, startX: mx, startY: my, origX: s.x, origY: s.y, origW: s.w, origH: s.h, mode: "move" };
        }
        return;
      }
    }
    setSelId(null);
  }, [sources, selId]);

  const onCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    const dx = mx - drag.startX;
    const dy = my - drag.startY;

    setSources(prev => prev.map(s => {
      if (s.id !== drag.srcId) return s;
      if (drag.mode === "move") {
        return { ...s, x: Math.max(0, Math.min(1 - s.w, drag.origX + dx)), y: Math.max(0, Math.min(1 - s.h, drag.origY + dy)) };
      } else {
        const newW = Math.max(0.05, drag.origW + dx);
        const newH = Math.max(0.05, drag.origH + dy);
        return { ...s, w: newW, h: newH };
      }
    }));
  }, []);

  const onCanvasMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // ─── Build combined stream ───
  const buildCombinedStream = useCallback((): MediaStream | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    // Video from canvas
    const cs = canvas.captureStream(30);

    // Audio from all sources
    if (!audioCtxRef.current) return cs;
    const dest = audioCtxRef.current.createMediaStreamDestination();
    audioNodesRef.current.forEach((node, id) => {
      const src = sources.find(s => s.id === id);
      if (src && src.visible && !src.muted) {
        node.gain.connect(dest);
      }
    });

    // Merge video + audio
    const combined = new MediaStream([...cs.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    return combined;
  }, [sources]);

  // ─── Start streaming ───
  const sendStartMessage = (ws: WebSocket) => {
    const p = PLATFORMS[platform];
    const url = platform === "custom" ? streamKey : `${p.url}/${streamKey}`;
    ws.send(JSON.stringify({ type: "start", rtmpUrl: url, width: canvasW, height: canvasH, fps: 30, bitrate: 6000 }));
  };

  const startStream = useCallback(async () => {
    if (!streamKey.trim()) return;
    setStreamStatus("connecting");

    try {
      const combined = buildCombinedStream();
      if (!combined) { setStreamStatus("error"); return; }
      combinedStreamRef.current = combined;

      // Get JWT token from cookie (httpOnly cookies are sent on WS upgrade automatically)
      // Server-side relay will read the cookie from the upgrade request

      // Connect to WebSocket relay
      const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${wsProto}//${window.location.host}/api/relay`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        // Cookie-based auth is handled on server side during WS upgrade
        // No need to send explicit auth message if cookie was valid
        // But send a ping to confirm auth state
        ws.send(JSON.stringify({ type: "auth-check" }));
      };

      ws.onerror = () => { setStreamStatus("error"); };
      ws.onclose = () => {
        setStreamStatus("offline");
        mediaRecorderRef.current?.stop();
        mediaRecorderRef.current = null;
        setRelayWs(null);
      };

      // Wait for auth confirmation or proceed if already authed via cookie
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "auth" && msg.ok) {
            // Explicit auth confirmed (for non-httpOnly fallback)
            sendStartMessage(ws);
          } else if (msg.type === "auth" && !msg.ok) {
            console.error("Relay auth failed:", msg.error);
            setStreamStatus("error");
            ws.close();
          } else if (msg.type === "status" && msg.status === "live") {
            // Already authenticated via cookie, start received
            const mr = new MediaRecorder(combined, {
              mimeType: getSupportedMimeType(),
              videoBitsPerSecond: 6000000,
            });
            mr.ondataavailable = (e) => {
              if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
                ws.send(e.data);
              }
            };
            mr.start(250);
            mediaRecorderRef.current = mr;
            setStreamStatus("live");
            setRelayWs(ws);
          } else if (msg.type === "status" && msg.status === "error") {
            console.error("Relay error:", msg.message);
            setStreamStatus("error");
          }
        } catch {}
      };

      // If already authed (cookie), send start immediately after small delay
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN && streamStatus === "connecting") {
          sendStartMessage(ws);
        }
      }, 500);
    } catch (e) {
      console.error("Stream start error:", e);
      setStreamStatus("error");
    }
  }, [platform, streamKey, buildCombinedStream, canvasW, canvasH]);

  // ─── Stop streaming ───
  const stopStream = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    if (relayWs) {
      relayWs.send(JSON.stringify({ type: "stop" }));
      relayWs.close();
    }
    setRelayWs(null);
    setStreamStatus("offline");
  }, [relayWs]);

  // ─── Start recording ───
  const startRecording = useCallback(() => {
    const combined = buildCombinedStream();
    if (!combined) return;
    combinedStreamRef.current = combined;

    const mimeType = getSupportedMimeType() || "video/webm";
    const mr = new MediaRecorder(combined, {
      mimeType,
      videoBitsPerSecond: 8000000,
    });
    recordChunksRef.current = [];
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) recordChunksRef.current.push(e.data);
    };
    mr.onstop = () => {
      const blob = new Blob(recordChunksRef.current, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `StreamBro-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      recordChunksRef.current = [];
    };
    mr.start(1000);
    mediaRecorderRef.current = mr;
    setRecording(true);
  }, [buildCombinedStream]);

  // ─── Stop recording ───
  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  }, []);

  // ─── Level meter ───
  const getLevel = useCallback((id: string): number => {
    const node = audioNodesRef.current.get(id);
    if (!node) return 0;
    const data = new Uint8Array(node.analyser.frequencyBinCount);
    node.analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return sum / data.length / 255;
  }, []);

  // ─── Loading / Auth gate ───
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-0)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(201,162,39,0.1)", border: "1px solid rgba(201,162,39,0.2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1rem", animation: "pulseGlow 2.5s ease-in-out infinite" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          </div>
          <p style={{ color: "var(--text-2)", fontSize: "0.85rem", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 }}>Загрузка студии</p>
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-0)" }}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: "1rem", color: "var(--text-0)" }}>Войдите в аккаунт</h2>
          <p style={{ color: "var(--text-2)", fontSize: "0.9rem", marginBottom: "1.5rem", lineHeight: 1.6 }}>Для использования StreamBro Студии необходим аккаунт. Стриминг, P2P и настройки привязаны к вашему профилю.</p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
            <Link href="/login" className="btn-gold" style={{ padding: "0.75rem 2rem", fontSize: "0.9rem" }}>Войти</Link>
            <Link href="/register" className="btn-ghost" style={{ padding: "0.75rem 2rem", fontSize: "0.9rem" }}>Регистрация</Link>
          </div>
        </div>
      </div>
    );
  }

  const sel = sources.find(s => s.id === selId);
  const statusColor: Record<StreamStatus, string> = { offline: "var(--text-2)", connecting: "#f59e0b", live: "#22c55e", error: "#ef4444" };
  const statusText: Record<StreamStatus, string> = { offline: "Оффлайн", connecting: "Подключение...", live: "В эфире", error: "Ошибка" };

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-0)", color: "var(--text-0)", fontFamily: "inherit", overflow: "hidden" }}>
      {/* ─── SIDEBAR — Sources + Mixer ─── */}
      <aside style={{ width: 280, flexShrink: 0, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", background: "rgba(5,5,16,0.6)" }}>
        {/* Header */}
        <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
            <span style={{ fontWeight: 800, fontSize: "0.9rem", color: "var(--text-0)" }}>StreamBro</span>
          </Link>
        </div>

        {/* Add source buttons */}
        <div style={{ padding: "0.75rem", borderBottom: "1px solid var(--border)", display: "flex", gap: 4, flexWrap: "wrap" }}>
          {([
            { type: "camera" as const, icon: "🎥", label: "Камера" },
            { type: "screen" as const, icon: "🖥", label: "Экран" },
            { type: "mic" as const, icon: "🎤", label: "Микрофон" },
          ]).map(btn => (
            <button key={btn.type} onClick={() => addSource(btn.type)} style={{
              padding: "0.4rem 0.6rem", fontSize: "0.75rem", borderRadius: "var(--r-sm)",
              background: "rgba(201,162,39,0.06)", border: "1px solid rgba(201,162,39,0.15)",
              color: "var(--text-1)", cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 4,
              transition: "all 0.15s ease",
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(201,162,39,0.3)"; (e.currentTarget as HTMLElement).style.color = "var(--gold)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(201,162,39,0.15)"; (e.currentTarget as HTMLElement).style.color = "var(--text-1)"; }}
            >{btn.icon} {btn.label}</button>
          ))}
        </div>

        {/* Source list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem" }}>
          {sources.length === 0 && (
            <div style={{ padding: "2rem 1rem", textAlign: "center" }}>
              <p style={{ color: "var(--text-2)", fontSize: "0.82rem", lineHeight: 1.6 }}>Добавьте камеру, экран или микрофон чтобы начать</p>
            </div>
          )}
          {sources.map(s => (
            <SourceCard
              key={s.id}
              source={s}
              selected={selId === s.id}
              level={getLevel(s.id)}
              onSelect={() => setSelId(s.id)}
              onRemove={() => removeSource(s.id)}
              onToggleMute={() => toggleMute(s.id)}
              onToggleVisible={() => toggleVisible(s.id)}
              onToggleLock={() => toggleLock(s.id)}
              onVolChange={v => setVol(s.id, v)}
            />
          ))}
        </div>

        {/* Stream status bar */}
        <div style={{ padding: "0.75rem", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor[streamStatus], boxShadow: streamStatus === "live" ? `0 0 8px ${statusColor[streamStatus]}` : "none" }} />
          <span style={{ fontSize: "0.78rem", color: statusColor[streamStatus], fontWeight: 600 }}>{statusText[streamStatus]}</span>
        </div>
      </aside>

      {/* ─── MAIN — Canvas ─── */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Canvas area */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", position: "relative", background: "var(--void)" }}>
          <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <canvas
              ref={canvasRef}
              width={canvasW}
              height={canvasH}
              style={{
                maxWidth: "100%", maxHeight: "100%",
                aspectRatio: `${canvasW}/${canvasH}`,
                borderRadius: "var(--r-sm)",
                border: "1px solid var(--border)",
                cursor: selId && sel && !sel.locked ? "move" : "default",
              }}
              onMouseDown={onCanvasMouseDown}
              onMouseMove={onCanvasMouseMove}
              onMouseUp={onCanvasMouseUp}
              onMouseLeave={onCanvasMouseUp}
            />
          </div>
        </div>

        {/* Bottom bar — Stream controls + recording */}
        <div style={{ height: 52, borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 1rem", gap: "0.75rem", background: "rgba(5,5,16,0.8)" }}>
          {/* Platform select */}
          <select value={platform} onChange={e => setPlatform(e.target.value as Platform)} style={{
            padding: "0.35rem 0.6rem", fontSize: "0.78rem", borderRadius: "var(--r-sm)",
            background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)",
            color: "var(--text-0)", cursor: "pointer", fontFamily: "inherit",
          }}>
            {Object.entries(PLATFORMS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>

          {/* Stream key */}
          <input
            type="password"
            value={streamKey}
            onChange={e => setStreamKey(e.target.value)}
            placeholder="Ключ стрима..."
            style={{
              flex: 1, maxWidth: 300, padding: "0.35rem 0.75rem", fontSize: "0.78rem",
              background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)",
              borderRadius: "var(--r-sm)", color: "var(--text-0)", fontFamily: "inherit", outline: "none",
            }}
          />

          {/* Stream button */}
          {streamStatus === "live" ? (
            <button onClick={stopStream} style={{
              padding: "0.4rem 1.2rem", fontSize: "0.82rem", borderRadius: "var(--r-sm)",
              background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)",
              color: "#ef4444", cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
            }}>Остановить</button>
          ) : (
            <button onClick={startStream} disabled={streamStatus === "connecting" || !streamKey.trim()} style={{
              padding: "0.4rem 1.2rem", fontSize: "0.82rem", borderRadius: "var(--r-sm)",
              background: "rgba(201,162,39,0.15)", border: "1px solid rgba(201,162,39,0.3)",
              color: "var(--gold)", cursor: streamStatus === "connecting" ? "wait" : "pointer",
              fontFamily: "inherit", fontWeight: 600, opacity: !streamKey.trim() ? 0.4 : 1,
            }}>
              {streamStatus === "connecting" ? "Подключение..." : "Стрим"}
            </button>
          )}

          <div style={{ width: 1, height: 24, background: "var(--border)" }} />

          {/* Record button */}
          {recording ? (
            <button onClick={stopRecording} style={{
              padding: "0.4rem 1rem", fontSize: "0.82rem", borderRadius: "var(--r-sm)",
              background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)",
              color: "#ef4444", cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
            }}>⏹ Стоп запись</button>
          ) : (
            <button onClick={startRecording} style={{
              padding: "0.4rem 1rem", fontSize: "0.82rem", borderRadius: "var(--r-sm)",
              background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)",
              color: "var(--text-1)", cursor: "pointer", fontFamily: "inherit",
            }}>⏺ Запись</button>
          )}

          {/* Resolution */}
          <select value={`${canvasW}x${canvasH}`} onChange={e => {
            const [w, h] = e.target.value.split("x").map(Number);
            setCanvasW(w); setCanvasH(h);
          }} style={{
            padding: "0.35rem 0.6rem", fontSize: "0.78rem", borderRadius: "var(--r-sm)",
            background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)",
            color: "var(--text-0)", cursor: "pointer", fontFamily: "inherit", marginLeft: "auto",
          }}>
            <option value="1920x1080">1920x1080</option>
            <option value="1280x720">1280x720</option>
            <option value="854x480">854x480</option>
          </select>
        </div>
      </main>

      {/* ─── RIGHT PANEL — Properties ─── */}
      {sel && (
        <aside style={{ width: 240, flexShrink: 0, borderLeft: "1px solid var(--border)", background: "rgba(5,5,16,0.6)", padding: "1rem", overflowY: "auto" }}>
          <h3 style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "1rem", color: "var(--gold)", letterSpacing: "0.04em", textTransform: "uppercase" }}>Свойства</h3>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {/* Source name */}
            <div>
              <label style={{ fontSize: "0.72rem", color: "var(--text-2)", display: "block", marginBottom: "0.25rem" }}>Название</label>
              <span style={{ fontSize: "0.85rem", color: "var(--text-0)" }}>{sel.name}</span>
            </div>

            {/* Position */}
            {sel.stream?.getVideoTracks().length !== 0 && (
              <>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--text-2)", display: "block", marginBottom: "0.25rem" }}>Позиция X</label>
                  <input type="range" min={0} max={100} value={Math.round(sel.x * 100)} onChange={e => {
                    const v = Number(e.target.value) / 100;
                    setSources(prev => prev.map(s => s.id === sel.id ? { ...s, x: v } : s));
                  }} style={{ width: "100%" }} />
                </div>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--text-2)", display: "block", marginBottom: "0.25rem" }}>Позиция Y</label>
                  <input type="range" min={0} max={100} value={Math.round(sel.y * 100)} onChange={e => {
                    const v = Number(e.target.value) / 100;
                    setSources(prev => prev.map(s => s.id === sel.id ? { ...s, y: v } : s));
                  }} style={{ width: "100%" }} />
                </div>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--text-2)", display: "block", marginBottom: "0.25rem" }}>Размер</label>
                  <input type="range" min={5} max={100} value={Math.round(sel.w * 100)} onChange={e => {
                    const v = Number(e.target.value) / 100;
                    setSources(prev => prev.map(s => s.id === sel.id ? { ...s, w: v, h: v * (canvasH / canvasW) } : s));
                  }} style={{ width: "100%" }} />
                </div>
              </>
            )}

            {/* Volume */}
            {sel.stream?.getAudioTracks().length !== 0 && (
              <div>
                <label style={{ fontSize: "0.72rem", color: "var(--text-2)", display: "block", marginBottom: "0.25rem" }}>Громкость: {Math.round(sel.vol * 100)}%</label>
                <input type="range" min={0} max={100} value={Math.round(sel.vol * 100)} onChange={e => setVol(sel.id, Number(e.target.value) / 100)} style={{ width: "100%" }} />
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SOURCE CARD COMPONENT
   ═══════════════════════════════════════════════════════════════ */
function SourceCard({ source, selected, level, onSelect, onRemove, onToggleMute, onToggleVisible, onToggleLock, onVolChange }: {
  source: Source;
  selected: boolean;
  level: number;
  onSelect: () => void;
  onRemove: () => void;
  onToggleMute: () => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onVolChange: (v: number) => void;
}) {
  const hasAudio = source.stream?.getAudioTracks().length !== 0;
  const hasVideo = source.stream?.getVideoTracks().length !== 0;
  const icon = source.type === "camera" ? "🎥" : source.type === "screen" ? "🖥" : source.type === "mic" ? "🎤" : "🔊";

  return (
    <div
      onClick={onSelect}
      style={{
        padding: "0.6rem", marginBottom: "0.35rem", borderRadius: "var(--r-sm)",
        background: selected ? "rgba(201,162,39,0.08)" : "rgba(255,255,255,0.02)",
        border: `1px solid ${selected ? "rgba(201,162,39,0.2)" : "transparent"}`,
        cursor: "pointer", transition: "all 0.15s ease",
      }}
    >
      {/* Top row — name + buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: hasAudio ? "0.4rem" : 0 }}>
        <span style={{ fontSize: "0.85rem" }}>{icon}</span>
        <span style={{ flex: 1, fontSize: "0.82rem", fontWeight: 600, color: source.visible ? "var(--text-0)" : "var(--text-2)", textDecoration: source.visible ? "none" : "line-through" }}>{source.name}</span>
        {/* Action buttons */}
        <button onClick={e => { e.stopPropagation(); onToggleVisible(); }} title={source.visible ? "Скрыть" : "Показать"} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "var(--text-2)", padding: "0 2px" }}>{source.visible ? "👁" : "👁‍🗨"}</button>
        {hasAudio && <button onClick={e => { e.stopPropagation(); onToggleMute(); }} title={source.muted ? "Вкл звук" : "Выкл звук"} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: source.muted ? "#ef4444" : "var(--text-2)", padding: "0 2px" }}>{source.muted ? "🔇" : "🔊"}</button>}
        <button onClick={e => { e.stopPropagation(); onToggleLock(); }} title={source.locked ? "Разблокировать" : "Заблокировать"} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: source.locked ? "var(--gold)" : "var(--text-2)", padding: "0 2px" }}>{source.locked ? "🔒" : "🔓"}</button>
        <button onClick={e => { e.stopPropagation(); onRemove(); }} title="Удалить" style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "var(--text-2)", padding: "0 2px" }}>✕</button>
      </div>

      {/* Volume slider + level meter */}
      {hasAudio && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="range" min={0} max={100}
            value={Math.round(source.vol * 100)}
            onChange={e => onVolChange(Number(e.target.value) / 100)}
            onClick={e => e.stopPropagation()}
            style={{ flex: 1, height: 3, accentColor: "var(--gold)" }}
          />
          <div style={{ width: 48, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, level * 300)}%`, height: "100%", background: level > 0.6 ? "#ef4444" : level > 0.3 ? "#f59e0b" : "#22c55e", borderRadius: 2, transition: "width 0.1s ease" }} />
          </div>
        </div>
      )}
    </div>
  );
}
