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

  function _escape(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }
  function _initials(name) { return (name || '?').trim().slice(0, 2).toUpperCase(); }

  // ─── Self status pill ───
  function _renderSelfStatus() {
    const el = $('friendsSelfStatus');
    if (!el || !_myProfile) return;
    const cur = _myProfile.statusManual || 'online';
    el.innerHTML = `
      <div class="self-status-row">
        <div class="self-avatar">${_myProfile.avatar
          ? `<img src="${_escape(_myProfile.avatar)}" alt=""/>`
          : _initials(_myProfile.nickname)}</div>
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

  // ─── Friends list ───
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
      return `
        <div class="friend-item ${isExpanded ? 'expanded' : ''}" data-fid="${_escape(f.id)}">
          <div class="friend-row" data-action="toggle">
            <div class="friend-avatar">
              ${f.avatar ? `<img src="${_escape(f.avatar)}" alt=""/>` : _initials(f.nickname)}
              <span class="friend-status-dot status-${_escape(f.status || 'offline')}" title="${_escape(STATUS_LABELS[f.status] || 'Offline')}"></span>
            </div>
            <div class="friend-meta">
              <div class="friend-nick">${_escape(f.nickname)}</div>
              <div class="friend-status-text">${STATUS_ICONS[f.status] || '⚫'} ${_escape(STATUS_LABELS[f.status] || 'Не в сети')}</div>
            </div>
            <div class="friend-actions">
              ${hasMail ? `<span class="mail-pulse" title="Новое сообщение">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <span class="mail-pulse-count">${unread > 9 ? '9+' : unread}</span>
              </span>` : ''}
              <button class="btn-icon sm friend-remove" data-action="remove" title="Удалить из друзей">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
          <div class="friend-chat" id="chat-${_escape(f.id)}" style="display:${isExpanded ? 'block' : 'none'}"></div>
        </div>`;
    }).join('');
    el.innerHTML = items;

    // Wire row clicks
    el.querySelectorAll('.friend-item').forEach(row => {
      const fid = row.dataset.fid;
      row.querySelector('[data-action="toggle"]').addEventListener('click', (e) => {
        if (e.target.closest('[data-action="remove"]')) return;
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
    });
  }

  // ─── Chat panel ───
  let _toggling = false; // guard against refresh() destroying chat mid-toggle

  async function _toggleChat(friendId) {
    if (_expanded === friendId) { _expanded = null; _renderList(); return; }
    _expanded = friendId;
    _toggling = true;
    try {
      _renderList();               // build DOM with display:block on expanded chat
      await _renderChat(friendId); // fill chat content
      await window.electronAPI.friendsMarkRead(friendId);
      _unread = await window.electronAPI.friendsUnread();
      _updateBadge();
      // Don't call _renderList() again — it would destroy the chat DOM.
      // Just update the unread counters in-place.
    } finally { _toggling = false; }
  }

  async function _renderChat(friendId) {
    const el = document.getElementById('chat-' + friendId);
    if (!el) return;
    const messages = await window.electronAPI.friendsChat(friendId);
    el.innerHTML = `
      <div class="chat-messages" id="chatMsgs-${_escape(friendId)}">
        ${messages.length
          ? messages.map(_renderMsg).join('')
          : '<div class="chat-empty">Нет сообщений. Напишите первым — удобно отправить код комнаты.</div>'}
      </div>
      <form class="chat-input-row" id="chatForm-${_escape(friendId)}">
        <input type="text" class="chat-input" id="chatInput-${_escape(friendId)}" placeholder="Сообщение..." maxlength="500" autocomplete="off"/>
        <button type="submit" class="btn-icon" title="Отправить">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </form>
    `;
    const msgsEl = document.getElementById('chatMsgs-' + friendId);
    if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;

    const form = document.getElementById('chatForm-' + friendId);
    const input = document.getElementById('chatInput-' + friendId);
    form && form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = (input && input.value || '').trim();
      if (!text) return;
      input.value = '';
      const r = await window.electronAPI.friendsSendMessage(friendId, text);
      if (r && r.success) {
        try { window.SBSounds && window.SBSounds.play('success'); } catch (er) {}
        await _renderChat(friendId);
      }
    });
    input && input.focus();
  }

  function _renderMsg(m) {
    const time = new Date(m.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const klass = m.from === 'me' ? 'chat-msg me' : 'chat-msg them';
    return `<div class="${klass}"><span class="chat-msg-text">${_escape(m.text)}</span><span class="chat-msg-time">${time}</span></div>`;
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
      if (code.length < 4) { try { window.SBSounds.play('error'); } catch (e) {} return; }
      const r = await window.electronAPI.friendsAdd({ code, message: (msgInp && msgInp.value) || '' });
      if (r && r.success) {
        try { window.SBSounds.play('notification'); } catch (e) {}
        if (modal) modal.style.display = 'none';
        if (codeInp) codeInp.value = '';
        if (msgInp) msgInp.value = '';
        alert('Заявка отправлена. Когда сервер подключим — друг получит её и подтвердит.');
      }
    });

    // Dev shortcut: instantly add a stub friend so we can test chat / pulse
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

  // ─── Refresh from store ───
  async function refresh() {
    try {
      _friends = await window.electronAPI.friendsList();
      _unread  = await window.electronAPI.friendsUnread();
    } catch (e) { _friends = []; _unread = {}; }
    if (_toggling) return; // don't destroy mid-toggle
    _renderList();
    // Re-render expanded chat if one is open
    if (_expanded) {
      // Small delay so _renderList's DOM is painted first
      setTimeout(() => _renderChat(_expanded), 10);
    }
    _updateBadge();
  }

  function _updateBadge() {
    const badge = document.getElementById('friendsBadge');
    if (!badge) return;
    const total = Object.values(_unread).reduce((s, c) => s + c, 0);
    if (total > 0) { badge.textContent = total > 99 ? '99+' : total; badge.style.display = 'inline-flex'; }
    else { badge.style.display = 'none'; }
  }

  // ─── Boot ───
  async function boot() {
    _wireAddModal();
    if (window.SBProfile && window.SBProfile.onChange) {
      window.SBProfile.onChange((p) => { _myProfile = p; _renderSelfStatus(); });
      _myProfile = window.SBProfile.getCached();
    }
    _renderSelfStatus();
    await refresh();

    // Live updates from main process
    if (window.electronAPI && window.electronAPI.onFriendsChanged) {
      window.electronAPI.onFriendsChanged(async (data) => {
        await refresh(); // refresh() is now safe — preserves expanded chat
        if (data && data.reason === 'friend-added') {
          try { window.SBSounds.play('friendOnline'); } catch (e) {}
        }
      });
    }
    if (window.electronAPI && window.electronAPI.onFriendsMessage) {
      window.electronAPI.onFriendsMessage(async (data) => {
        if (data && data.msg && data.msg.from !== 'me') {
          try { window.SBSounds.play('message'); } catch (e) {}
        }
        // Just update unread + re-render the relevant chat — don't rebuild the whole list
        _unread = await window.electronAPI.friendsUnread();
        _updateBadge();
        if (data && data.friendId) {
          // Update the unread dot on the friend row
          const row = document.querySelector(`.friend-item[data-fid="${data.friendId}"] .mail-pulse`);
          // We'll let the next full refresh handle the full badge update
          if (data.friendId === _expanded) {
            await _renderChat(data.friendId);
          }
        }
      });
    }
  }

  global.SBFriends = {
    boot,
    refresh,
    expandChat: _toggleChat,
    STATUS_LIST,
    STATUS_ICONS,
    STATUS_LABELS,
  };
})(window);
