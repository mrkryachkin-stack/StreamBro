// StreamBro — friends list / chat UI (renderer)
// v2: переписано для стабильности — чат отдельным persistent контейнером,
// список друзей и чат не пересоздают друг друга.
//
// Архитектура:
//   #friendsList → только список (мини-карточки). Не содержит чата.
//   #friendChatPanel → отдельный контейнер чата. Создаётся 1 раз при первом открытии.
//   Сообщения добавляются в DOM инкрементально, без re-render всего чата.
//
// Talks to: window.electronAPI.friends*, profile-ui (status sync), SBSounds.

(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STATUS_LIST   = ['online', 'streaming', 'gaming', 'away', 'dnd', 'invisible', 'offline'];
  const STATUS_ICONS  = { online: '🟢', offline: '⚫', streaming: '🔴', gaming: '🟣', away: '🟡', dnd: '🔵', invisible: '⚪' };
  const STATUS_LABELS = { online: 'Онлайн', offline: 'Не в сети', streaming: 'Стримлю', gaming: 'Играю', away: 'Отошёл', dnd: 'Не беспокоить', invisible: 'Невидимка' };

  // State
  let _friends = [];
  let _unread = {};
  let _expanded = null;        // currently shown friendId (chat panel)
  let _myProfile = null;
  let _chatMessages = {};      // friendId → messages[] cache
  let _chatLoaded  = {};       // friendId → bool (initial fetch done)
  let _syncTimer = null;
  let _booted = false;

  // ─── Helpers ───
  function _escape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }
  function _initials(name) { return (name || '?').trim().slice(0, 2).toUpperCase(); }

  const SERVER_BASE = 'https://streambro.ru';
  function _avatarUrl(url) {
    if (!url) return '';
    if (url.startsWith('/')) return SERVER_BASE + url;
    return url;
  }
  function _avatarImg(url, nick) {
    const resolved = _avatarUrl(url);
    if (resolved && (resolved.startsWith('http') || resolved.startsWith('avatar:'))) {
      return `<img src="${_escape(resolved)}" alt="" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none';if(this.nextSibling)this.nextSibling.style.display='flex';"/>` +
             `<span class="avatar-initials" style="display:none">${_escape(_initials(nick))}</span>`;
    }
    if (resolved && resolved.length <= 4) return _escape(resolved);
    return `<span class="avatar-initials">${_escape(_initials(nick))}</span>`;
  }

  function _myUserId() {
    if (!_myProfile) return null;
    return _myProfile.serverId || _myProfile.id || null;
  }

  function _isSupportFriend(f) {
    return f && f.nickname && (f.nickname === 'StreamBro Поддержка' || f.nickname.startsWith('StreamBro'));
  }

  // ─── Notification settings ───
  function _getPerFriend(friendId) {
    if (!window.S || !S.settings || !S.settings.friends) return {};
    const pf = S.settings.friends.perFriend;
    return (pf && pf[friendId]) || {};
  }
  function _isNotifSoundOn(friendId) {
    return _getPerFriend(friendId).sound !== false;
  }
  function _setPerFriend(friendId, key, value) {
    if (!window.S || !S.settings) return;
    if (!S.settings.friends) S.settings.friends = {};
    if (!S.settings.friends.perFriend) S.settings.friends.perFriend = {};
    if (!S.settings.friends.perFriend[friendId]) S.settings.friends.perFriend[friendId] = {};
    S.settings.friends.perFriend[friendId][key] = value;
    if (typeof window._scheduleSettingsSave === 'function') window._scheduleSettingsSave();
  }
  function _getGlobalNotif() {
    if (!window.S || !S.settings || !S.settings.friends) return {};
    return S.settings.friends.notifications || {};
  }
  function _setGlobalNotif(key, val) {
    if (!window.S || !S.settings) return;
    if (!S.settings.friends) S.settings.friends = {};
    if (!S.settings.friends.notifications) S.settings.friends.notifications = {};
    S.settings.friends.notifications[key] = val;
    if (typeof window._scheduleSettingsSave === 'function') window._scheduleSettingsSave();
  }
  function _notifSoundAllowed(friendId) {
    const g = _getGlobalNotif();
    if (g.sound === false) return false;
    if (friendId) return _isNotifSoundOn(friendId);
    return true;
  }

  // ─── Self status row ───
  function _renderSelfStatus() {
    const el = $('friendsSelfStatus');
    if (!el || !_myProfile) return;
    const cur = _myProfile.statusManual || 'online';
    el.innerHTML = `
      <div class="self-status-row">
        <div class="self-avatar">${_avatarImg(_myProfile.avatar, _myProfile.nickname)}</div>
        <div class="self-meta">
          <div class="self-nick">${_escape(_myProfile.nickname || 'Я')}</div>
          <select class="self-status-select" id="friendsSelfStatusSelect">
            ${STATUS_LIST.map(s => `<option value="${s}" ${s === cur ? 'selected' : ''}>${STATUS_ICONS[s]} ${STATUS_LABELS[s]}</option>`).join('')}
          </select>
        </div>
      </div>`;
    const sel = $('friendsSelfStatusSelect');
    if (sel) sel.addEventListener('change', () => {
      window.electronAPI.profileUpdate({ statusManual: sel.value });
    });
  }

  // ─── Friends list (only list, no chat) ───
  function _renderList() {
    const el = $('friendsList');
    if (!el) return;
    if (!_friends.length) {
      el.innerHTML = `
        <div class="friends-empty">
          <p>Друзей пока нет.</p>
          <p class="friends-empty-sub">Добавьте друга по коду — он появится здесь и сможет писать вам прямо в приложении.</p>
        </div>`;
      return;
    }
    const items = _friends.map(f => {
      const unread = _unread[f.id] || 0;
      const isExpanded = _expanded === f.id;
      const hasMail = unread > 0;
      const isSupport = _isSupportFriend(f);
      const soundOn = _isNotifSoundOn(f.id);
      return `
        <div class="friend-item ${isExpanded ? 'expanded' : ''}" data-fid="${_escape(f.id)}">
          <div class="friend-row" data-action="toggle">
            <div class="friend-avatar">
              ${_avatarImg(f.avatar, f.nickname)}
              <span class="friend-status-dot status-${_escape(f.status || 'offline')}" title="${_escape(STATUS_LABELS[f.status] || 'Offline')}"></span>
            </div>
            <div class="friend-meta">
              <div class="friend-nick">${_escape(f.nickname)}${isSupport ? ' <span style="font-size:0.65rem;background:var(--accent);color:#000;padding:0.1rem 0.35rem;border-radius:4px;font-weight:700;vertical-align:middle;margin-left:0.3rem">Поддержка</span>' : ''}</div>
              <div class="friend-status-text">${STATUS_ICONS[f.status] || '⚫'} ${_escape(STATUS_LABELS[f.status] || 'Не в сети')}</div>
            </div>
            <div class="friend-actions">
              ${hasMail ? `<span class="mail-pulse" title="Новое сообщение">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <span class="mail-pulse-count">${unread > 9 ? '9+' : unread}</span>
              </span>` : ''}
              ${!isSupport ? `<button class="btn-icon sm friend-remove" data-action="remove" title="Удалить из друзей">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>` : ''}
            </div>
          </div>
          <div class="friend-notif-row" style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0.6rem 0.5rem">
            <button type="button" class="friend-notif-btn" data-action="toggle-sound" style="cursor:pointer;background:${soundOn ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)'};color:${soundOn ? '#86efac' : '#fca5a5'};border:1px solid ${soundOn ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'};border-radius:5px;padding:0.25rem 0.6rem;font-size:0.72rem;font-weight:600">${soundOn ? '🔊 Звук: ВКЛ' : '🔇 Звук: ВЫКЛ'}</button>
          </div>
        </div>`;
    }).join('');
    el.innerHTML = items;

    // Wire interactions
    el.querySelectorAll('.friend-item').forEach(row => {
      const fid = row.dataset.fid;
      const toggleEl = row.querySelector('[data-action="toggle"]');
      toggleEl && toggleEl.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="remove"]')) return;
        if (e.target.closest('[data-action="toggle-sound"]')) return;
        _openChat(fid);
      });
      const rmBtn = row.querySelector('[data-action="remove"]');
      rmBtn && rmBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const f = _friends.find(x => x.id === fid);
        if (!f) return;
        if (!confirm('Удалить ' + f.nickname + ' из друзей?')) return;
        await window.electronAPI.friendsRemove(fid);
        await refresh();
      });
      const soundBtn = row.querySelector('[data-action="toggle-sound"]');
      soundBtn && soundBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const newVal = !_isNotifSoundOn(fid);
        _setPerFriend(fid, 'sound', newVal);
        soundBtn.textContent = newVal ? '🔊 Звук: ВКЛ' : '🔇 Звук: ВЫКЛ';
        if (newVal) {
          soundBtn.style.background = 'rgba(34,197,94,0.18)';
          soundBtn.style.color = '#86efac';
          soundBtn.style.borderColor = 'rgba(34,197,94,0.35)';
        } else {
          soundBtn.style.background = 'rgba(239,68,68,0.18)';
          soundBtn.style.color = '#fca5a5';
          soundBtn.style.borderColor = 'rgba(239,68,68,0.35)';
        }
      });
    });
  }

  // ─── Chat panel (separate persistent container) ───
  function _ensureChatPanel() {
    let panel = $('friendChatPanel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'friendChatPanel';
    panel.className = 'friend-chat-panel';
    panel.style.cssText = 'display:none;position:fixed;right:1rem;bottom:1rem;width:360px;height:480px;background:var(--bg1,#1a1a2e);border:1px solid var(--glass-border,rgba(255,255,255,0.08));border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.5);z-index:9000;flex-direction:column;overflow:hidden;';
    panel.innerHTML = `
      <div class="chat-header" id="chatHeader" style="display:flex;align-items:center;gap:0.5rem;padding:0.6rem 0.8rem;background:var(--bg2,#22223a);border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.08))">
        <div class="chat-header-avatar" id="chatHeaderAvatar" style="width:32px;height:32px;border-radius:50%;background:var(--bg3,#2a2a48);display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:0.9rem;font-weight:600"></div>
        <div style="flex:1;min-width:0">
          <div class="chat-header-nick" id="chatHeaderNick" style="font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
          <div class="chat-header-status" id="chatHeaderStatus" style="font-size:0.72rem;color:var(--text2,#94a3b8)"></div>
        </div>
        <button class="btn-icon sm" id="chatCloseBtn" title="Закрыть" style="background:transparent;border:none;cursor:pointer;color:var(--text,#fff);padding:4px">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="chat-messages" id="chatMessages" style="flex:1;overflow-y:auto;padding:0.6rem 0.8rem;display:flex;flex-direction:column;gap:0.3rem"></div>
      <form class="chat-input-row" id="chatInputForm" style="display:flex;gap:0.4rem;padding:0.5rem 0.6rem;background:var(--bg2,#22223a);border-top:1px solid var(--glass-border,rgba(255,255,255,0.08))">
        <input type="text" id="chatInputField" placeholder="Сообщение..." maxlength="500" autocomplete="off" style="flex:1;background:var(--bg3,#2a2a48);border:1px solid var(--glass-border,rgba(255,255,255,0.08));border-radius:6px;padding:0.5rem 0.7rem;color:var(--text,#fff);font-size:0.85rem;outline:none"/>
        <button type="submit" class="btn-icon" id="chatSendBtn" title="Отправить" style="background:var(--accent,#8b5cf6);border:none;cursor:pointer;color:#fff;border-radius:6px;padding:0 0.7rem">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </form>
    `;
    document.body.appendChild(panel);

    // Wire close button
    const closeBtn = $('chatCloseBtn');
    closeBtn && closeBtn.addEventListener('click', () => _closeChat());

    // Wire send form
    const form = $('chatInputForm');
    const input = $('chatInputField');
    form && form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = (input && input.value || '').trim();
      if (!text || !_expanded) return;
      input.value = '';
      input.disabled = true;
      try {
        const r = await window.electronAPI.friendsSendMessage(_expanded, text);
        if (r && (r.success || r.id || r.ok)) {
          try { window.SBSounds && window.SBSounds.play('success'); } catch (er) {}
          const myUserId = _myUserId();
          const newMsg = {
            id: r.id || (r.msg && r.msg.id) || ('local-' + Date.now()),
            from: 'me',
            text,
            content: text,
            ts: Date.now(),
            createdAt: new Date().toISOString(),
            senderId: myUserId,
          };
          if (!_chatMessages[_expanded]) _chatMessages[_expanded] = [];
          _chatMessages[_expanded].push(newMsg);
          _appendMessageToDOM(newMsg, myUserId);
        } else {
          if (window.msg) window.msg('Ошибка отправки сообщения');
        }
      } catch (err) {
        if (window.msg) window.msg('Ошибка: ' + (err.message || err));
      } finally {
        input.disabled = false;
        input.focus();
      }
    });

    // Wire context menu on messages
    const msgsEl = $('chatMessages');
    msgsEl && msgsEl.addEventListener('contextmenu', (e) => {
      const msgEl = e.target.closest('.chat-msg');
      if (!msgEl) return;
      const msgId = msgEl.dataset.msgId;
      const isOwn = msgEl.dataset.fromMe === '1';
      e.preventDefault();
      _showMsgContextMenu(e, msgId, _expanded, msgEl, isOwn);
    });

    return panel;
  }

  function _openChat(friendId) {
    if (_expanded === friendId) { _closeChat(); return; }
    _expanded = friendId;
    const f = _friends.find(x => x.id === friendId);
    const panel = _ensureChatPanel();
    panel.style.display = 'flex';

    // Update header
    const headerNick = $('chatHeaderNick');
    const headerStatus = $('chatHeaderStatus');
    const headerAvatar = $('chatHeaderAvatar');
    if (f) {
      headerNick && (headerNick.textContent = f.nickname || 'Друг');
      headerStatus && (headerStatus.innerHTML = (STATUS_ICONS[f.status] || '⚫') + ' ' + _escape(STATUS_LABELS[f.status] || 'Не в сети'));
      if (headerAvatar) headerAvatar.innerHTML = _avatarImg(f.avatar, f.nickname);
    }

    // Render cached messages immediately, then load fresh from server in background
    _renderChatMessages();
    setTimeout(() => { $('chatInputField') && $('chatInputField').focus(); }, 50);

    if (!_chatLoaded[friendId]) {
      _loadChatFromServer(friendId);
    } else {
      // Refresh in background to catch new messages
      _loadChatFromServer(friendId, true);
    }

    // Mark read + update badge
    window.electronAPI.friendsMarkRead(friendId).catch(() => {});
    _unread[friendId] = 0;
    _renderList();
    _updateBadge();
  }

  function _closeChat() {
    _expanded = null;
    const panel = $('friendChatPanel');
    if (panel) panel.style.display = 'none';
    _renderList();
  }

  async function _loadChatFromServer(friendId, isBackground) {
    try {
      const messages = await window.electronAPI.friendsChat(friendId);
      const arr = Array.isArray(messages) ? messages : [];
      // Merge: keep local-only messages (no server id), add server ones
      const localOnly = (_chatMessages[friendId] || []).filter(m => String(m.id || '').startsWith('local-'));
      _chatMessages[friendId] = [...arr, ...localOnly];
      _chatLoaded[friendId] = true;
      if (_expanded === friendId) _renderChatMessages();
    } catch (e) {
      if (window.__sbDev) console.warn('[Chat] load failed:', e);
    }
  }

  function _renderChatMessages() {
    const msgsEl = $('chatMessages');
    if (!msgsEl || !_expanded) return;
    const messages = _chatMessages[_expanded] || [];
    const myUserId = _myUserId();
    if (!messages.length) {
      msgsEl.innerHTML = '<div class="chat-empty" style="color:var(--text2,#64748b);text-align:center;padding:2rem 0;font-size:0.85rem">Нет сообщений. Напишите первым.</div>';
      return;
    }
    // Sort by timestamp ascending
    messages.sort((a, b) => {
      const ta = a.ts || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const tb = b.ts || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return ta - tb;
    });
    msgsEl.innerHTML = messages.map(m => _renderMsgHTML(m, myUserId)).join('');
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function _renderMsgHTML(m, myUserId) {
    const ts = m.ts || (m.createdAt ? new Date(m.createdAt).getTime() : Date.now());
    const time = new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const isMe = m.from === 'me' || (m.senderId && m.senderId === myUserId);
    const klass = isMe ? 'chat-msg me' : 'chat-msg them';
    const isEdited = m.edited || false;
    const msgId = m.id || m.messageId || '';
    const fromMeAttr = isMe ? 'data-from-me="1"' : 'data-from-me="0"';
    const msgIdAttr = msgId ? `data-msg-id="${_escape(msgId)}"` : '';
    const tsAttr = `data-ts="${ts}"`;
    const text = m.text != null ? m.text : m.content;
    const align = isMe ? 'flex-end' : 'flex-start';
    const bg = isMe ? 'var(--accent,#8b5cf6)' : 'var(--bg3,#2a2a48)';
    const color = isMe ? '#fff' : 'var(--text,#e2e8f0)';
    return `<div class="${klass}" ${fromMeAttr} ${msgIdAttr} ${tsAttr} style="display:flex;flex-direction:column;align-items:${align};max-width:85%;${isMe ? 'align-self:flex-end' : 'align-self:flex-start'}">
      <div style="background:${bg};color:${color};padding:0.4rem 0.7rem;border-radius:10px;font-size:0.85rem;word-break:break-word;line-height:1.3"><span class="chat-msg-text">${_escape(text)}</span></div>
      <div style="font-size:0.65rem;color:var(--text2,#64748b);margin-top:0.15rem;display:flex;gap:0.3rem">${isEdited ? '<span class="chat-msg-edited">ред.</span>' : ''}<span class="chat-msg-time">${time}</span></div>
    </div>`;
  }

  function _appendMessageToDOM(msg, myUserId) {
    const msgsEl = $('chatMessages');
    if (!msgsEl) return;
    // Clear empty placeholder if present
    const empty = msgsEl.querySelector('.chat-empty');
    if (empty) empty.remove();
    const tmp = document.createElement('div');
    tmp.innerHTML = _renderMsgHTML(msg, myUserId);
    const child = tmp.firstElementChild;
    if (child) {
      msgsEl.appendChild(child);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
  }

  function _showMsgContextMenu(e, msgId, friendId, msgEl, isOwn) {
    const existing = document.querySelector('.chat-ctx-menu');
    if (existing) existing.remove();

    const msgTs = msgEl.dataset.ts ? parseInt(msgEl.dataset.ts) : 0;
    const canEdit = isOwn && msgId && msgTs && (Date.now() - msgTs < 2 * 60 * 1000);

    const menu = document.createElement('div');
    menu.className = 'chat-ctx-menu';
    menu.style.cssText = `position:fixed;left:-9999px;top:-9999px;background:var(--bg1,#1a1a2e);border:1px solid var(--glass-border,rgba(255,255,255,0.08));border-radius:8px;padding:4px 0;z-index:10001;min-width:160px;box-shadow:0 4px 16px rgba(0,0,0,.4);`;

    if (isOwn && msgId && !String(msgId).startsWith('local-')) {
      if (canEdit) {
        const editBtn = document.createElement('div');
        editBtn.textContent = '✏️ Редактировать';
        editBtn.style.cssText = 'padding:7px 14px;cursor:pointer;font-size:0.82rem;color:var(--text,#fff);';
        editBtn.addEventListener('mouseenter', () => { editBtn.style.background = 'var(--bg2,#22223a)'; });
        editBtn.addEventListener('mouseleave', () => { editBtn.style.background = ''; });
        editBtn.addEventListener('click', () => { menu.remove(); _startInlineEdit(msgId, friendId, msgEl); });
        menu.appendChild(editBtn);
      }

      const deleteBtn = document.createElement('div');
      deleteBtn.textContent = '🗑️ Удалить';
      deleteBtn.style.cssText = 'padding:7px 14px;cursor:pointer;font-size:0.82rem;color:var(--red,#ef4444);';
      deleteBtn.addEventListener('mouseenter', () => { deleteBtn.style.background = 'var(--bg2,#22223a)'; });
      deleteBtn.addEventListener('mouseleave', () => { deleteBtn.style.background = ''; });
      deleteBtn.addEventListener('click', async () => {
        menu.remove();
        if (!confirm('Удалить сообщение?')) return;
        const r = await window.electronAPI.chatDelete(msgId);
        if (r && (r.ok || r.success)) {
          msgEl.remove();
          _chatMessages[friendId] = (_chatMessages[friendId] || []).filter(m => (m.id !== msgId && m.messageId !== msgId));
        } else {
          if (window.msg) window.msg((r && r.error) || 'Ошибка удаления');
        }
      });
      menu.appendChild(deleteBtn);
    }

    const copyBtn = document.createElement('div');
    copyBtn.textContent = '📋 Копировать';
    copyBtn.style.cssText = `padding:7px 14px;cursor:pointer;font-size:0.82rem;color:var(--text,#fff);${isOwn && msgId ? 'border-top:1px solid var(--glass-border,rgba(255,255,255,0.08));margin-top:2px;' : ''}`;
    copyBtn.addEventListener('mouseenter', () => { copyBtn.style.background = 'var(--bg2,#22223a)'; });
    copyBtn.addEventListener('mouseleave', () => { copyBtn.style.background = ''; });
    copyBtn.addEventListener('click', () => {
      menu.remove();
      const text = msgEl.querySelector('.chat-msg-text')?.textContent || '';
      navigator.clipboard.writeText(text).catch(() => {});
    });
    menu.appendChild(copyBtn);

    document.body.appendChild(menu);
    const mw = menu.offsetWidth || 160;
    const mh = menu.offsetHeight || 80;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = e.clientX, y = e.clientY;
    if (x + mw > vw - 8) x = vw - mw - 8;
    if (y + mh > vh - 8) y = vh - mh - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const closeHandler = (ev) => {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closeHandler); }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
  }

  function _startInlineEdit(msgId, friendId, msgEl) {
    const textEl = msgEl.querySelector('.chat-msg-text');
    if (!textEl || msgEl.dataset.editing) return;
    msgEl.dataset.editing = '1';
    const original = textEl.textContent || '';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = original;
    input.maxLength = 500;
    input.style.cssText = 'width:100%;background:rgba(255,255,255,0.08);border:1px solid var(--accent,#8b5cf6);border-radius:4px;padding:2px 6px;font-size:0.85rem;color:var(--text,#fff);outline:none;';
    textEl.replaceWith(input);
    input.focus();
    input.select();

    const finish = async (save) => {
      if (!msgEl.dataset.editing) return;
      delete msgEl.dataset.editing;
      if (!save || !input.value.trim() || input.value.trim() === original) {
        input.replaceWith(textEl);
        return;
      }
      const newText = input.value.trim();
      input.disabled = true;
      const r = await window.electronAPI.chatEdit(msgId, newText);
      if (r && (r.ok || r.success)) {
        textEl.textContent = newText;
        input.replaceWith(textEl);
        const cached = _chatMessages[friendId];
        if (cached) {
          const idx = cached.findIndex(m => m.id === msgId || m.messageId === msgId);
          if (idx >= 0) { cached[idx].text = newText; cached[idx].content = newText; cached[idx].edited = true; }
        }
        if (!msgEl.querySelector('.chat-msg-edited')) {
          const mark = document.createElement('span');
          mark.className = 'chat-msg-edited';
          mark.textContent = 'ред.';
          mark.style.cssText = 'font-size:0.65rem;color:var(--text2,#64748b);';
          const time = msgEl.querySelector('.chat-msg-time');
          time && time.before(mark);
        }
      } else {
        input.replaceWith(textEl);
        if (window.msg) window.msg((r && r.error) || 'Ошибка редактирования');
      }
    };

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(false));
  }

  // ─── Add friend modal ───
  function _wireAddModal() {
    const open = $('btnFriendAdd');
    const modal = $('addFriendModal');
    const close = $('btnCloseAddFriend');
    const sendBtn = $('btnFriendAddSend');
    const devBtn  = $('btnFriendAddDev');
    const codeInp = $('friendAddCode');
    const msgInp  = $('friendAddMessage');

    open && open.addEventListener('click', () => { if (modal) modal.style.display = 'flex'; });
    close && close.addEventListener('click', () => { if (modal) modal.style.display = 'none'; });
    modal && modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    sendBtn && sendBtn.addEventListener('click', async () => {
      const code = (codeInp && codeInp.value || '').trim();
      if (code.length < 2) { try { window.SBSounds.play('error'); } catch (e) {} return; }
      try {
        const r = await window.electronAPI.friendsAdd({ code, message: (msgInp && msgInp.value) || '' });
        if (r && r.success) {
          try { window.SBSounds.play('notification'); } catch (e) {}
          if (modal) modal.style.display = 'none';
          if (codeInp) codeInp.value = '';
          if (msgInp) msgInp.value = '';
          if (window.msg) window.msg(r.offline ? 'Заявка сохранена локально' : 'Заявка отправлена!');
        } else {
          const errText = (r && r.error) || 'Не удалось отправить заявку';
          if (window.msg) window.msg(errText); else alert(errText);
        }
      } catch (err) {
        if (window.msg) window.msg('Ошибка: ' + (err.message || err));
      }
    });

    devBtn && devBtn.addEventListener('click', async () => {
      const nick = (codeInp && codeInp.value.trim()) || 'Тестовый друг';
      const r = await window.electronAPI.friendsDevAdd({ nickname: nick, status: 'online' });
      if (r && r.success) {
        try { window.SBSounds.play('friendOnline'); } catch (e) {}
        if (modal) modal.style.display = 'none';
        if (codeInp) codeInp.value = '';
        await refresh();
      }
    });
  }

  // ─── Global notification toggle buttons (top of friends panel) ───
  function _styleNotifBtn(btn, on) {
    if (!btn) return;
    if (on) {
      btn.style.background = 'rgba(34,197,94,0.18)';
      btn.style.color = '#86efac';
      btn.style.borderColor = 'rgba(34,197,94,0.35)';
    } else {
      btn.style.background = 'rgba(239,68,68,0.18)';
      btn.style.color = '#fca5a5';
      btn.style.borderColor = 'rgba(239,68,68,0.35)';
    }
  }
  function _wireGlobalNotifSliders() {
    const soundBtn = $('globalNotifSound');
    const badgeBtn = $('globalNotifBadge');
    const n = _getGlobalNotif();

    if (soundBtn) {
      const isOn = n.sound !== false;
      soundBtn.textContent = isOn ? '🔊 Звук: ВКЛ' : '🔇 Звук: ВЫКЛ';
      _styleNotifBtn(soundBtn, isOn);
      // Replace to clear any prior listeners
      const fresh = soundBtn.cloneNode(true);
      soundBtn.parentNode.replaceChild(fresh, soundBtn);
      fresh.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const cur = _getGlobalNotif();
        const newVal = cur.sound === false; // toggle
        _setGlobalNotif('sound', newVal);
        fresh.textContent = newVal ? '🔊 Звук: ВКЛ' : '🔇 Звук: ВЫКЛ';
        _styleNotifBtn(fresh, newVal);
      });
    }
    if (badgeBtn) {
      const isOn = n.badge !== false;
      badgeBtn.textContent = isOn ? '🔔 Бейдж: ВКЛ' : '🔕 Бейдж: ВЫКЛ';
      _styleNotifBtn(badgeBtn, isOn);
      const fresh = badgeBtn.cloneNode(true);
      badgeBtn.parentNode.replaceChild(fresh, badgeBtn);
      fresh.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const cur = _getGlobalNotif();
        const newVal = cur.badge === false;
        _setGlobalNotif('badge', newVal);
        fresh.textContent = newVal ? '🔔 Бейдж: ВКЛ' : '🔕 Бейдж: ВЫКЛ';
        _styleNotifBtn(fresh, newVal);
        _updateBadge();
      });
    }
  }

  // ─── Refresh from store ───
  async function refresh() {
    try {
      _friends = await window.electronAPI.friendsList();
      _unread  = await window.electronAPI.friendsUnread();
    } catch (e) { _friends = []; _unread = {}; }
    _renderList();
    _updateBadge();
    // Update chat header status if open
    if (_expanded) {
      const f = _friends.find(x => x.id === _expanded);
      if (f) {
        const nick = $('chatHeaderNick');
        const status = $('chatHeaderStatus');
        nick && (nick.textContent = f.nickname || 'Друг');
        status && (status.innerHTML = (STATUS_ICONS[f.status] || '⚫') + ' ' + _escape(STATUS_LABELS[f.status] || 'Не в сети'));
      }
    }
  }

  function _updateBadge() {
    const badge = $('friendsBadge');
    if (!badge) return;
    const notif = _getGlobalNotif();
    const showBadge = notif.badge !== false;
    const total = Object.values(_unread).reduce((s, c) => s + (c || 0), 0);
    if (total > 0 && showBadge) { badge.textContent = total > 99 ? '99+' : total; badge.style.display = 'inline-flex'; }
    else { badge.style.display = 'none'; }
  }

  // ─── Boot ───
  async function boot() {
    if (_booted) return;
    _booted = true;

    _wireAddModal();
    _wireGlobalNotifSliders();

    if (window.SBProfile && window.SBProfile.onChange) {
      window.SBProfile.onChange((p) => { _myProfile = p; _renderSelfStatus(); });
      _myProfile = window.SBProfile.getCached();
    }
    _renderSelfStatus();
    await refresh();

    _syncTimer = setInterval(async () => {
      try { await window.electronAPI.friendsSync(); } catch (e) {}
    }, 30000);

    // Live: friend list changes (accept request, status, etc)
    if (window.electronAPI && window.electronAPI.onFriendsChanged) {
      window.electronAPI.onFriendsChanged(async (data) => {
        if (data && (data.reason === 'friend-accepted' || data.reason === 'friend-request')) {
          try { await window.electronAPI.friendsSync(); } catch (e) {}
        }
        try {
          _friends = await window.electronAPI.friendsList();
          _unread  = await window.electronAPI.friendsUnread();
        } catch (e) {}
        _renderList();
        _updateBadge();
        if (data && data.reason === 'friend-added' && _notifSoundAllowed(data.friendId || data.userId)) {
          try { window.SBSounds.play('friendOnline'); } catch (e) {}
        }
        if (data && data.reason === 'friend-request' && _notifSoundAllowed(data.userId)) {
          try { window.SBSounds.play('message'); } catch (e) {}
        }
      });
    }

    // Live: incoming chat message
    if (window.electronAPI && window.electronAPI.onFriendsMessage) {
      window.electronAPI.onFriendsMessage(async (data) => {
        if (!data) return;
        const friendId = data.friendId;
        const msg = data.msg || data;
        const myUserId = _myUserId();
        const isMe = msg.from === 'me' || (msg.senderId && msg.senderId === myUserId);

        // Add to cache
        if (friendId && !isMe) {
          if (!_chatMessages[friendId]) _chatMessages[friendId] = [];
          // Dedupe by id
          const exists = _chatMessages[friendId].some(m => (m.id && msg.id && m.id === msg.id) || (m.messageId && msg.messageId && m.messageId === msg.messageId));
          if (!exists) _chatMessages[friendId].push(msg);
        }

        // Update unread + badge
        try { _unread = await window.electronAPI.friendsUnread(); } catch (e) {}
        _updateBadge();

        // If chat is open with this friend → append + mark read
        if (friendId && friendId === _expanded && !isMe) {
          _appendMessageToDOM(msg, myUserId);
          window.electronAPI.friendsMarkRead(friendId).catch(() => {});
          _unread[friendId] = 0;
          _updateBadge();
        } else if (!isMe) {
          _renderList(); // refresh list to show mail-pulse
          if (_notifSoundAllowed(friendId)) {
            try { window.SBSounds.play('message'); } catch (e) {}
          }
        }
      });
    }
  }

  function reset() {
    _friends = [];
    _expanded = null;
    _chatMessages = {};
    _chatLoaded = {};
    _unread = {};
    _booted = false;
    if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null; }
    const el = $('friendsList');
    if (el) el.innerHTML = '';
    const panel = $('friendChatPanel');
    if (panel) panel.style.display = 'none';
  }

  global.SBFriends = {
    boot,
    refresh,
    reset,
    expandChat: _openChat,
    STATUS_LIST,
    STATUS_ICONS,
    STATUS_LABELS,
  };
})(window);
