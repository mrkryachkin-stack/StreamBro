const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // app meta
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  isPackaged: () => ipcRenderer.invoke('is-packaged'),

  // sources / displays
  getMediaSources: () => ipcRenderer.invoke('get-media-sources'),
  setPreferredDisplaySource: (id) => ipcRenderer.invoke('set-preferred-display-source', id),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  showInFolder: (opts) => ipcRenderer.invoke('show-in-folder', opts),

  // signaling
  startSignalingServer: () => ipcRenderer.invoke('start-signaling-server'),
  stopSignalingServer: () => ipcRenderer.invoke('stop-signaling-server'),

  // ffmpeg paths
  getFFmpegPath: () => ipcRenderer.invoke('get-ffmpeg-path'),
  getVideosDir: () => ipcRenderer.invoke('get-videos-dir'),

  // local recording
  startFFmpegRecording: (opts) => ipcRenderer.invoke('start-ffmpeg-recording', opts),
  stopFFmpegRecording: () => ipcRenderer.invoke('stop-ffmpeg-recording'),
  writeRecChunk: (chunk) => ipcRenderer.invoke('write-rec-chunk', { chunk }),
  onFFmpegRecStopped: (cb) => ipcRenderer.on('ffmpeg-rec-stopped', (_, data) => cb(data)),
  saveRecFile: (opts) => ipcRenderer.invoke('save-rec-file', opts),
  convertToMp4: (opts) => ipcRenderer.invoke('convert-to-mp4', opts),

  // RTMP streaming
  startStream: (opts) => ipcRenderer.invoke('start-ffmpeg-stream', opts),
  stopStream: () => ipcRenderer.invoke('stop-ffmpeg-stream'),
  writeStreamChunk: (chunk) => ipcRenderer.invoke('write-stream-chunk', { chunk }),
  onStreamStatus: (cb) => ipcRenderer.on('stream-status', (_, data) => cb(data)),

  // Settings (persistent)
  settingsLoad: () => ipcRenderer.invoke('settings-load'),
  settingsSave: (s) => ipcRenderer.invoke('settings-save', s),
  settingsGetStreamKey: () => ipcRenderer.invoke('settings-get-stream-key'),

  // External links (open in default browser)
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // WASAPI native audio capture
  wasapiGetOutputDevices: () => ipcRenderer.invoke('wasapi-get-output-devices'),
  wasapiGetDeviceFormat: (opts) => ipcRenderer.invoke('wasapi-get-device-format', opts),
  wasapiStartCapture: (opts) => ipcRenderer.invoke('wasapi-start-capture', opts),
  wasapiStopCapture: () => ipcRenderer.invoke('wasapi-stop-capture'),
  wasapiIsCapturing: () => ipcRenderer.invoke('wasapi-is-capturing'),
  onWasapiAudioData: (cb) => ipcRenderer.on('wasapi-audio-data', (_, data) => cb(data)),
  onWasapiError: (cb) => ipcRenderer.on('wasapi-error', (_, err) => cb(err)),
  onWasapiDeviceChanged: (cb) => ipcRenderer.on('wasapi-device-changed', (_, data) => cb(data)),

  // ─── Profile (1.1.0) ───
  profileGet:        () => ipcRenderer.invoke('profile-get'),
  profileUpdate:     (patch) => ipcRenderer.invoke('profile-update', patch),
  profileLogout:     () => ipcRenderer.invoke('profile-logout'),
  profileOpenSignup: () => ipcRenderer.invoke('profile-open-signup'),
  profileOpenLogin:  () => ipcRenderer.invoke('profile-open-login'),
  profileOpenPage:   () => ipcRenderer.invoke('profile-open-page'),
  profileDevLogin:   (payload) => ipcRenderer.invoke('profile-dev-login', payload),
  profileLogin:      (creds) => ipcRenderer.invoke('profile-login', creds),
  profileRegister:   (creds) => ipcRenderer.invoke('profile-register', creds),
  onProfileUpdated:  (cb) => ipcRenderer.on('profile-updated', (_, data) => cb(data)),

  // ─── Friends / chat (1.1.0) ───
  friendsList:        () => ipcRenderer.invoke('friends-list'),
  friendsRequests:    () => ipcRenderer.invoke('friends-requests'),
  friendsChat:        (friendId) => ipcRenderer.invoke('friends-chat', friendId),
  friendsUnread:      () => ipcRenderer.invoke('friends-unread'),
  friendsAdd:         (payload) => ipcRenderer.invoke('friends-add', payload),
  friendsDevAdd:      (payload) => ipcRenderer.invoke('friends-dev-add', payload),
  friendsRemove:      (friendId) => ipcRenderer.invoke('friends-remove', friendId),
  friendsSetStatus:   (friendId, status) => ipcRenderer.invoke('friends-set-status', { friendId, status }),
  friendsSendMessage: (friendId, text) => ipcRenderer.invoke('friends-send-msg', { friendId, text }),
  friendsMarkRead:    (friendId) => ipcRenderer.invoke('friends-mark-read', friendId),
  friendsDevInbound:  (friendId, text) => ipcRenderer.invoke('friends-dev-inbound', { friendId, text }),
  onFriendsChanged:   (cb) => ipcRenderer.on('friends-changed', (_, data) => cb(data)),
  onFriendsMessage:   (cb) => ipcRenderer.on('friends-message', (_, data) => cb(data)),

  // ─── Bug reporter (1.1.0) ───
  bugReport:        (payload) => ipcRenderer.invoke('bug-report', payload),
  bugFlush:         () => ipcRenderer.invoke('bug-flush'),
  bugQueueSize:     () => ipcRenderer.invoke('bug-queue-size'),
  bugClearQueue:    () => ipcRenderer.invoke('bug-clear-queue'),

  // ─── Auto-updater (1.1.0) ───
  updaterCheck:        () => ipcRenderer.invoke('updater-check'),
  updaterDownload:     () => ipcRenderer.invoke('updater-download'),
  updaterInstall:      () => ipcRenderer.invoke('updater-install'),
  updaterSetChannel:   (ch) => ipcRenderer.invoke('updater-set-channel', ch),
  onUpdateState:       (cb) => ipcRenderer.on('update-state', (_, data) => cb(data)),
});
