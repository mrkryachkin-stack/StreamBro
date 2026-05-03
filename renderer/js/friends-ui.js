// StreamBro — friends list / chat UI (renderer)
// Renders the "Друзья" accordion section in the right sidebar:
//   - inline status picker for the user
//   - list of friends with avatar + status dot + envelope-pulse for unread
//   - click on a friend → expands an inline chat panel
//
// Talks to: window.electronAPI.friends*, profile-ui (status sync), SBSounds.

(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STATUS_LIST   = ['online', 'streaming', 'gaming', 'away', 'dnd', 'invisible', 'offline'];
  const STATUS_ICONS  = { online: '🟢', offline: '⚫', streaming: '🔴', gaming: '🟣', away: '🟡', dnd: '🔵', invisible: '⚪' };
  const STATUS_LABELS = { online: 'Онлайн', offline: 'Не в сети', streaming: 'Стримлю', gaming: 'Играю', away: 'Отошёл', dnd: 'Не беспокоить', invisible: 'Невидимка' };

  let _friends = [];
  let _unread = {};
  let _expanded = null; // friendId currently shown chat for
  let _myProfile = null;
  let _chatMessages = {}; // friendId → messages[] cache

  function _escape(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
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
      return `<img src="${_escape(resolved)}" alt="" onerror="this.style.display='none';this.nextSibling&&(this.nextSibling.style.display='flex')"/>` +
             `<span class="avatar-initials" style="display:none">${_initials(nick)}</span>`;
    }
    if (resolved && resolved.length <= 4) {
      // Emoji avatar
      return _escape(resolved);
    }
    return `<span class="avatar-initials">${_initials(nick)}</span>`;
  }

  // ─── Self status pill ───
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
    sel && sel.addEventListener('change', () => {
      window.electronAPI.profileUpdate({ statusManual: sel.value });
    });
  }

  // ─── Per-friend notification settings ───
  function _getPerFriend(friendId) {
    if (!window.S || !S.settings || !S.settings.friends) return {};
    const pf = S.settings.friends.perFriend;
    return (pf && pf[friendId]) || {};
  }
  function _isNotifSoundOn(friendId) {
    const pf = _getPerFriend(friendId);
    return pf.sound !== false;
  }
  function _setPerFriend(friendId, key, value) {
    if (!window.S || !S.settings) return;
    if (!S.settings.friends) S.settings.friends = {};
    if (!S.settings.friends.perFriend) S.settings.friends.perFriend = {};
    if (!S.settings.friends.perFriend[friendId]) S.settings.friends.perFriend[friendId] = {};
    S.settings.friends.perFriend[friendId][key] = value;
    if (typeof _scheduleSettingsSave === 'function') _scheduleSettingsSave();
  }

  function _isSupportFriend(f) {
    return f && (f.nickname === 'StreamBro Поддержка' || (f.nickname && f.nickname.startsWith('StreamBro') && f.serverId));
  }

  // ─── Friends list ───
  function _renderList() {
    const el = $('friendsList');
    if (!el) return;
    // Preserve open chat content before DOM rebuild
    let savedChatHtml = null;
    let savedChatId = null;
    if (_expanded) {
      const chatEl = document.getElementById('chat-' + _expanded);
      if (chatEl && chatEl.innerHTML.trim()) {
        savedChatHtml = chatEl.innerHTML;
        savedChatId = _expanded;
      }
    }
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
          <div class="friend-notif-row">
            <span class="friend-notif-label">🔊 Звук</span>
            <div class="friend-slider ${soundOn ? 'on' : 'off'}" data-action="toggle-sound"><span class="friend-slider-track"><span class="friend-slider-thumb"></span></span></div>
          </div>
          <div class="friend-chat" id="chat-${_escape(f.id)}" style="display:${isExpanded ? 'block' : 'none'}"></div>
        </div>`;
    }).join('');
    el.innerHTML = items;

    // Restore saved chat content
    if (savedChatHtml && savedChatId) {
      const chatEl = document.getElementById('chat-' + savedChatId);
      if (chatEl) {
        chatEl.innerHTML = savedChatHtml;
        chatEl.scrollTop = chatEl.scrollHeight;
      }
    }

    // Wire row clicks
    el.querySelectorAll('.friend-item').forEach(row => {
      const fid = row.dataset.fid;
      row.querySelector('[data-action="toggle"]').addEventListener('click', (e) => {
        if (e.target.closest('[data-action="remove"]')) return;
        if (e.target.closest('[data-action="toggle-sound"]')) return;
        _toggleChat(fid);
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
      // Sound slider toggle
      const soundSlider = row.querySelector('[data-action="toggle-sound"]');
      soundSlider && soundSlider.addEventListener('click', (e) => {
        e.stopPropagation();
        const newVal = !_isNotifSoundOn(fid);
        _setPerFriend(fid, 'sound', newVal);
        // Update slider visual without full re-render
        const slider = e.currentTarget;
        slider.classList.toggle('on', newVal);
        slider.classList.toggle('off', !newVal);
      });
    });
  }

  // ─── Chat panel ───
  let _toggling = false;

  async function _toggleChat(friendId) {
    if (_expanded === friendId) { _expanded = null; _renderList(); return; }
    const prev = _expanded;
    _expanded = friendId;
    _toggling = true;
    try {
      _renderList();
      await _loadAndRenderChat(friendId);
      await window.electronAPI.friendsMarkRead(friendId);
      _unread = await window.electronAPI.friendsUnread();
      _updateBadge();
    } finally { _toggling = false; }
  }

  async function _loadAndRenderChat(friendId, force) {
    const el = document.getElementById('chat-' + friendId);
    if (!el) return;
    // Only fetch from server if no cached messages or forced
    if (!force && _chatMessages[friendId] && _chatMessages[friendId].length > 0) {
      _renderChatDOM(friendId, el, _chatMessages[friendId]);
      return;
    }
    const messages = await window.electronAPI.friendsChat(friendId);
    _chatMessages[friendId] = messages || [];
    _renderChatDOM(friendId, el, _chatMessages[friendId]);
  }

  function _renderChatDOM(friendId, el, messages) {
    const myUserId = (_myProfile && _myProfile.serverId) || (_myProfile && _myProfile.id) || null;
    el.innerHTML = `
      <div class="chat-messages" id="chatMsgs-${_escape(friendId)}">
        ${messages.length
          ? messages.map(m => _renderMsg(m, myUserId)).join('')
          : '<div class="chat-empty">Нет сообщений. Напишите первым.</div>'}
      </div>
      <form class="chat-input-row" id="chatForm-${_escape(friendId)}">
        <input type="text" class="chat-input" id="chatInput-${_escape(friendId)}" placeholder="Сообщение..." maxlength="500" autocomplete="off"/>
        <button type="submit" class="btn-icon" title="Отправить">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </form>`;
    const msgsEl = document.getElementById('chatMsgs-' + friendId);
    if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;

    // Wire form submit
    const form = document.getElementById('chatForm-' + friendId);
    const input = document.getElementById('chatInput-' + friendId);
    form && form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = (input && input.value || '').trim();
      if (!text) return;
      input.value = '';
      input.disabled = true;
      try {
        const r = await window.electronAPI.friendsSendMessage(friendId, text);
        if (r && (r.success || r.id)) {
          try { window.SBSounds && window.SBSounds.play('success'); } catch (er) {}
          const newMsg = { id: r.id || '', from: 'me', text, ts: Date.now(), senderId: myUserId };
          _chatMessages[friendId] = _chatMessages[friendId] || [];
          _chatMessages[friendId].push(newMsg);
          _appendMessageToDOM(friendId, newMsg, myUserId);
        } else {
          await _loadAndRenderChat(friendId);
        }
      } finally {
        input.disabled = false;
        input.focus();
      }
    });

    // Wire context menu on ALL messages (right-click)
    const msgsContainer = document.getElementById('chatMsgs-' + friendId);
    if (msgsContainer) {
      msgsContainer.addEventListener('contextmenu', (e) => {
        const msgEl = e.target.closest('.chat-msg');
        if (!msgEl) return;
        const msgId = msgEl.dataset.msgId;
        const isOwn = msgEl.dataset.fromMe === '1';
        e.preventDefault();
        _showMsgContextMenu(e, msgId, friendId, msgEl, isOwn);
      });
    }

    input && input.focus();
  }

  function _showMsgContextMenu(e, msgId, friendId, msgEl, isOwn) {
    const existing = document.querySelector('.chat-ctx-menu');
    if (existing) existing.remove();

    // Check if message is editable (< 2 minutes old)
    const msgTs = msgEl.dataset.ts ? parseInt(msgEl.dataset.ts) : 0;
    const canEdit = isOwn && msgId && msgTs && (Date.now() - msgTs < 2 * 60 * 1000);

    const menu = document.createElement('div');
    menu.className = 'chat-ctx-menu';
    // Temporary positioning to measure, then smart-position
    menu.style.cssText = `position:fixed;left:-9999px;top:-9999px;background:var(--bg1);border:1px solid var(--glass-border);border-radius:8px;padding:4px 0;z-index:10000;min-width:150px;box-shadow:0 4px 16px rgba(0,0,0,.4);`;

    if (isOwn && msgId) {
      if (canEdit) {
        const editBtn = document.createElement('div');
        editBtn.textContent = '✏️ Редактировать';
        editBtn.style.cssText = 'padding:7px 14px;cursor:pointer;font-size:0.82rem;color:var(--text);';
        editBtn.addEventListener('mouseenter', () => { editBtn.style.background = 'var(--bg2)'; });
        editBtn.addEventListener('mouseleave', () => { editBtn.style.background = ''; });
        editBtn.addEventListener('click', () => {
          menu.remove();
          _startInlineEdit(msgId, friendId, msgEl);
        });
        menu.appendChild(editBtn);
      }

      const deleteBtn = document.createElement('div');
      deleteBtn.textContent = '🗑️ Удалить';
      deleteBtn.style.cssText = 'padding:7px 14px;cursor:pointer;font-size:0.82rem;color:var(--red);';
      deleteBtn.addEventListener('mouseenter', () => { deleteBtn.style.background = 'var(--bg2)'; });
      deleteBtn.addEventListener('mouseleave', () => { deleteBtn.style.background = ''; });
      deleteBtn.addEventListener('click', async () => {
        menu.remove();
        if (!confirm('Удалить сообщение?')) return;
        const r = await window.electronAPI.chatDelete(msgId);
        if (r && r.ok) {
          msgEl.remove();
          _chatMessages[friendId] = (_chatMessages[friendId] || []).filter(m => m.id !== msgId);
        } else {
          if (window.msg) window.msg(r?.error || 'Ошибка');
        }
      });
      menu.appendChild(deleteBtn);
    }

    const copyBtn = document.createElement('div');
    copyBtn.textContent = '📋 Копировать';
    copyBtn.style.cssText = `padding:7px 14px;cursor:pointer;font-size:0.82rem;color:var(--text);${isOwn && msgId ? 'border-top:1px solid var(--glass-border);margin-top:2px;' : ''}`;
    copyBtn.addEventListener('mouseenter', () => { copyBtn.style.background = 'var(--bg2)'; });
    copyBtn.addEventListener('mouseleave', () => { copyBtn.style.background = ''; });
    copyBtn.addEventListener('click', () => {
      menu.remove();
      const text = msgEl.querySelector('.chat-msg-text')?.textContent || '';
      navigator.clipboard.writeText(text).catch(() => {});
    });
    menu.appendChild(copyBtn);

    document.body.appendChild(menu);

    // Smart positioning — keep within viewport
    const mw = menu.offsetWidth || 160;
    const mh = menu.offsetHeight || 80;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = e.clientX;
    let y = e.clientY;
    if (x + mw > vw - 8) x = vw - mw - 8;
    if (y + mh > vh - 8) y = vh - mh - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    // Close on click outside
    const closeHandler = (ev) => {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closeHandler); }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
  }

  // Inline edit: replaces message text with an input field
  function _startInlineEdit(msgId, friendId, msgEl) {
    const textEl = msgEl.querySelector('.chat-msg-text');
    if (!textEl || msgEl.dataset.editing) return;
    msgEl.dataset.editing = '1';
    const original = textEl.textContent || '';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = original;
    input.maxLength = 500;
    input.style.cssText = 'width:100%;background:var(--input-bg);border:1px solid var(--accent);border-radius:4px;padding:2px 6px;font-size:12px;color:var(--text);outline:none;';
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
      if (r && r.ok) {
        textEl.textContent = newText;
        input.replaceWith(textEl);
        // Update cache
        const cached = _chatMessages[friendId];
        if (cached) {
          const idx = cached.findIndex(m => m.id === msgId || m.messageId === msgId);
          if (idx >= 0) { cached[idx].text = newText; cached[idx].content = newText; cached[idx].edited = true; }
        }
        // Add edited mark if not present
        if (!msgEl.querySelector('.chat-msg-edited')) {
          const mark = document.createElement('span');
          mark.className = 'chat-msg-edited';
          mark.textContent = 'ред.';
          msgEl.querySelector('.chat-msg-time')?.before(mark);
        }
      } else {
        input.replaceWith(textEl);
        if (window.msg) window.msg(r?.error || 'Ошибка редактирования');
      }
    };

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(false));
  }

  function _appendMessageToDOM(friendId, msg, myUserId) {
    const msgsEl = document.getElementById('chatMsgs-' + friendId);
    if (!msgsEl) return;
    const div = document.createElement('div');
    div.innerHTML = _renderMsg(msg, myUserId);
    const child = div.firstElementChild;
    if (child) {
      msgsEl.appendChild(child);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
  }

  function _renderMsg(m, myUserId) {
    const ts = m.ts || (m.createdAt ? new Date(m.createdAt).getTime() : Date.now());
    const time = new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    // Server messages use senderId, local use 'from'
    const isMe = m.from === 'me' || (m.senderId && m.senderId === myUserId);
    const klass = isMe ? 'chat-msg me' : 'chat-msg them';
    const isEdited = m.edited || false;
    const msgId = m.id || m.messageId || '';
    const fromMeAttr = isMe ? 'data-from-me="1"' : '';
    const msgIdAttr = msgId ? `data-msg-id="${_escape(msgId)}"` : '';
    const tsAttr = `data-ts="${ts}"`;
    return `<div class="${klass}" ${fromMeAttr} ${msgIdAttr} ${tsAttr}><span class="chat-msg-text">${_escape(m.text || m.content)}</span>${isEdited ? '<span class="chat-msg-edited">ред.</span>' : ''}<span class="chat-msg-time">${time}</span></div>`;
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
          if (r.offline) {
            if (window.msg) window.msg('Заявка сохранена локально');
          } else {
            if (window.msg) window.msg('Заявка отправлена!');
          }
        } else {
          const errText = (r && r.error) || 'Не удалось отправить заявку';
          if (window.msg) window.msg(errText);
          else alert(errText);
        }
      } catch (err) {
        if (window.__sbDev) console.warn('[Friends] add error:', err);
        if (window.msg) window.msg('Ошибка: ' + + (err.message || err));
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

  // ─── Global notification sliders ───
  function _wireGlobalNotifSliders() {
    const soundSlider = $('globalNotifSound');
    const badgeSlider = $('globalNotifBadge');

    function _getGlobalNotif() {
      if (!window.S || !S.settings || !S.settings.friends) return {};
      return S.settings.friends.notifications || {};
    }
    function _setGlobalNotif(key, val) {
      if (!window.S || !S.settings) return;
      if (!S.settings.friends) S.settings.friends = {};
      if (!S.settings.friends.notifications) S.settings.friends.notifications = {};
      S.settings.friends.notifications[key] = val;
      if (typeof _scheduleSettingsSave === 'function') _scheduleSettingsSave();
    }

    // Init state
    const n = _getGlobalNotif();
    if (soundSlider) {
      soundSlider.classList.toggle('on', n.sound !== false);
      soundSlider.classList.toggle('off', n.sound === false);
      soundSlider.addEventListener('click', () => {
        const cur = _getGlobalNotif();
        const newVal = cur.sound === false;
        _setGlobalNotif('sound', newVal);
        soundSlider.classList.toggle('on', newVal);
        soundSlider.classList.toggle('off', !newVal);
      });
    }
    if (badgeSlider) {
      badgeSlider.classList.toggle('on', n.badge !== false);
      badgeSlider.classList.toggle('off', n.badge === false);
      badgeSlider.addEventListener('click', () => {
        const cur = _getGlobalNotif();
        const newVal = cur.badge === false;
        _setGlobalNotif('badge', newVal);
        badgeSlider.classList.toggle('on', newVal);
        badgeSlider.classList.toggle('off', !newVal);
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
    if (_toggling) return;
    _renderList();
    // Don't reload open chat on refresh — only update friends list metadata
    _updateBadge();
  }

  function _updateBadge() {
    const badge = document.getElementById('friendsBadge');
    if (!badge) return;
    const notif = (window.S && S.settings && S.settings.friends && S.settings.friends.notifications) || {};
    const showBadge = notif.badge !== false;
    const total = Object.values(_unread).reduce((s, c) => s + c, 0);
    if (total > 0 && showBadge) { badge.textContent = total > 99 ? '99+' : total; badge.style.display = 'inline-flex'; }
    else { badge.style.display = 'none'; }
  }

  function _notifSoundAllowed(friendId) {
    const globalOff = window.S && S.settings && S.settings.friends && S.settings.friends.notifications && S.settings.friends.notifications.sound === false;
    if (globalOff) return false;
    if (friendId) return _isNotifSoundOn(friendId);
    return true;
  }

  // ─── Boot ───
  let _syncTimer = null;
  let _observer = null; // auto-refresh on visibility
  async function boot() {
    _wireAddModal();
    _wireGlobalNotifSliders();

    if (window.SBProfile && window.SBProfile.onChange) {
      window.SBProfile.onChange((p) => { _myProfile = p; _renderSelfStatus(); });
      _myProfile = window.SBProfile.getCached();
    }
    _renderSelfStatus();
    await refresh();

    // Periodic server sync every 30 seconds
    _syncTimer = setInterval(async () => {
      try { await window.electronAPI.friendsSync(); } catch (e) {}
    }, 30000);

    // Auto-refresh when friends section becomes visible
    const friendsSection = document.querySelector('.accordion-section.friends-section');
    if (friendsSection && typeof MutationObserver !== 'undefined') {
      _observer = new MutationObserver(() => {
        const isOpen = friendsSection.classList.contains('open') || friendsSection.dataset.open === '1';
        if (isOpen) {
          // Sync + refresh when friends panel opens
          window.electronAPI.friendsSync().then(() => refresh()).catch(() => {});
        }
      });
      _observer.observe(friendsSection, { attributes: true, attributeFilter: ['class', 'data-open'] });
    }

    // Live updates from main process
    if (window.electronAPI && window.electronAPI.onFriendsChanged) {
      window.electronAPI.onFriendsChanged(async (data) => {
        if (data && (data.reason === 'friend-accepted' || data.reason === 'friend-request')) {
          try { await window.electronAPI.friendsSync(); } catch (e) {}
        }
        // Only full refresh if chat is NOT open (avoids flicker)
        if (!_expanded) {
          await refresh();
        } else {
          // Lightweight update: just refresh friend metadata without rebuilding chat
          try {
            _friends = await window.electronAPI.friendsList();
            _unread  = await window.electronAPI.friendsUnread();
          } catch (e) {}
          _updateBadge();
        }
        if (data && data.reason === 'friend-added') {
          if (_notifSoundAllowed(data.friendId || data.userId)) try { window.SBSounds.play('friendOnline'); } catch (e) {}
        }
        if (data && data.reason === 'friend-request') {
          if (_notifSoundAllowed(data.userId)) try { window.SBSounds.play('message'); } catch (e) {}
        }
      });
    }
    if (window.electronAPI && window.electronAPI.onFriendsMessage) {
      window.electronAPI.onFriendsMessage(async (data) => {
          if (data && data.msg && data.msg.from !== 'me') {
            if (_notifSoundAllowed(data.friendId)) try { window.SBSounds.play('message'); } catch (e) {}
          }
        _unread = await window.electronAPI.friendsUnread();
        _updateBadge();
        if (data && data.friendId) {
          if (data.friendId === _expanded) {
            const msg = data.msg || data;
            const myUserId = (_myProfile && _myProfile.serverId) || (_myProfile && _myProfile.id) || null;
            const isMe = msg.from === 'me' || msg.senderId === myUserId;
            if (!isMe) {
              _chatMessages[data.friendId] = _chatMessages[data.friendId] || [];
              _chatMessages[data.friendId].push(msg);
              _appendMessageToDOM(data.friendId, msg, myUserId);
              await window.electronAPI.friendsMarkRead(data.friendId);
            }
          }
        }
      });
    }
  }

  function reset() {
    _friends = [];
    _expanded = null;
    _chatMessages = {};
    _unread = {};
    _toggling = false;
    if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null; }
    const el = $('friendsList');
    if (el) el.innerHTML = '';
  }

  global.SBFriends = {
    boot,
    refresh,
    reset,
    expandChat: _toggleChat,
    STATUS_LIST,
    STATUS_ICONS,
    STATUS_LABELS,
  };
})(window);
