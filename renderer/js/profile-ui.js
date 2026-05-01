// StreamBro — profile / welcome / settings UI (renderer)
// Owns: welcome overlay shown on first launch, profile editor inside the
// settings modal, deep-link login feedback.
//
// Public surface (window.SBProfile):
//   - boot()           — call once at app start; shows welcome if needed
//   - openEditor()     — opens the profile editor inside the settings modal
//   - getCached()      — last loaded public profile object
//   - onChange(cb)     — subscribe to profile changes (login/logout/edit)

(function (global) {
  'use strict';

  let _profile = null;
  const _listeners = new Set();
  const $ = (id) => document.getElementById(id);

  function _emit() { for (const cb of _listeners) { try { cb(_profile); } catch (e) {} } }

  async function _refresh() {
    try {
      _profile = await window.electronAPI.profileGet();
    } catch (e) { _profile = null; }
    _emit();
    _renderSettingsCard();
    return _profile;
  }

  // ─── Welcome overlay (shown on first launch / when not registered) ───
  function _showWelcome() {
    const el = $('welcomeOverlay');
    if (!el) return;
    el.style.display = 'flex';
    requestAnimationFrame(() => el.classList.add('visible'));
  }
  function _hideWelcome() {
    const el = $('welcomeOverlay');
    if (!el) return;
    el.classList.remove('visible');
    setTimeout(() => { el.style.display = 'none'; }, 250);
  }

  function _wireWelcome() {
    const overlay = $('welcomeOverlay');
    if (!overlay) return;

    const btnSignup = $('welcomeBtnSignup');
    const btnLogin  = $('welcomeBtnLogin');
    const btnDev    = $('welcomeBtnDev');
    const cbBugs    = $('welcomeCbBugs');
    const cbTos     = $('welcomeCbTos');
    const inpNick   = $('welcomeInpNick');

    // Default: enable bug reports (matches user request to gather telemetry)
    if (cbBugs) cbBugs.checked = true;

    btnSignup && btnSignup.addEventListener('click', async () => {
      if (cbTos && !cbTos.checked) {
        try { window.SBSounds && window.SBSounds.play('error'); } catch (e) {}
        _flashTos();
        return;
      }
      await window.electronAPI.profileUpdate({
        consents: { bugReports: !!(cbBugs && cbBugs.checked), tos: true },
      });
      window.electronAPI.profileOpenSignup();
      // Keep overlay open with hint — user will return after deep link.
      _showSignupHint();
    });

    btnLogin && btnLogin.addEventListener('click', async () => {
      await window.electronAPI.profileUpdate({
        consents: { bugReports: !!(cbBugs && cbBugs.checked), tos: !!(cbTos && cbTos.checked) },
      });
      window.electronAPI.profileOpenLogin();
      _showSignupHint();
    });

    btnDev && btnDev.addEventListener('click', async () => {
      const nick = (inpNick && inpNick.value.trim()) || 'Stream Brother';
      await window.electronAPI.profileUpdate({
        nickname: nick,
        consents: { bugReports: !!(cbBugs && cbBugs.checked), tos: true },
      });
      const r = await window.electronAPI.profileDevLogin({ nickname: nick });
      if (r && r.success) {
        try { window.SBSounds && window.SBSounds.play('success'); } catch (e) {}
        _hideWelcome();
        await _refresh();
      }
    });
  }

  function _flashTos() {
    const wrap = $('welcomeTosWrap');
    if (!wrap) return;
    wrap.classList.remove('flash');
    void wrap.offsetWidth;
    wrap.classList.add('flash');
  }

  function _showSignupHint() {
    const hint = $('welcomeSignupHint');
    if (hint) hint.style.display = 'block';
  }

  // ─── Profile section inside the Settings modal ───
  function _renderSettingsCard() {
    const card = $('settingsProfileCard');
    if (!card) return;
    if (!_profile) {
      card.innerHTML = '<div class="profile-empty">Профиль не загружен</div>';
      return;
    }
    const initials = (_profile.nickname || '?').slice(0, 2).toUpperCase();
    const statusLabel = STATUS_LABELS[_profile.statusManual] || _profile.statusManual;
    const consentBugs = !!(_profile.consents && _profile.consents.bugReports);
    const consentAna  = !!(_profile.consents && _profile.consents.analytics);

    card.innerHTML = `
      <div class="profile-row">
        <div class="profile-avatar" id="profileAvatar">${_profile.avatar
          ? `<img src="${_escape(_profile.avatar)}" alt=""/>`
          : initials}</div>
        <div class="profile-meta">
          <div class="profile-nick"><input type="text" id="profileNickInput" value="${_escape(_profile.nickname || '')}" maxlength="32" placeholder="Ник"/></div>
          <div class="profile-email">${_profile.email ? _escape(_profile.email) : '<span class="profile-muted">(локальный аккаунт)</span>'}</div>
          <div class="profile-id">ID: ${_escape(_profile.serverId || _profile.id || '—')}</div>
        </div>
      </div>
      <div class="form-group">
        <label>Статус по умолчанию</label>
        <select id="profileStatusSelect">
          ${STATUS_LIST.map(s => `<option value="${s}" ${s === _profile.statusManual ? 'selected' : ''}>${STATUS_ICONS[s]} ${STATUS_LABELS[s]}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="profile-check"><input type="checkbox" id="profileAutoStreaming" ${_profile.autoStreamingStatus ? 'checked' : ''}/> Автостатус «Стримлю» при запуске стрима</label>
      </div>
      <div class="form-group">
        <label class="profile-check"><input type="checkbox" id="profileConsentBugs" ${consentBugs ? 'checked' : ''}/> Отправлять анонимные баг-репорты для улучшения приложения</label>
        <label class="profile-check"><input type="checkbox" id="profileConsentAnalytics" ${consentAna ? 'checked' : ''}/> Отправлять анонимную статистику использования (отключено)</label>
      </div>
      <div class="profile-actions">
        ${_profile.registered
          ? `<button class="btn" id="profileBtnOpenWeb">Открыть профиль на сайте</button>
             <button class="btn" id="profileBtnLogout">Выйти</button>`
          : `<button class="btn btn-accent" id="profileBtnSignup">Регистрация на сайте</button>
             <button class="btn" id="profileBtnLogin">Войти</button>`
        }
      </div>
      <div class="profile-bug-status" id="profileBugStatus"></div>
    `;

    const nickInput = $('profileNickInput');
    nickInput && nickInput.addEventListener('change', () => {
      const v = nickInput.value.trim().slice(0, 32);
      window.electronAPI.profileUpdate({ nickname: v || 'Без имени' }).then(() => _refresh());
    });

    const statusSel = $('profileStatusSelect');
    statusSel && statusSel.addEventListener('change', () => {
      window.electronAPI.profileUpdate({ statusManual: statusSel.value }).then(() => _refresh());
    });

    const auto = $('profileAutoStreaming');
    auto && auto.addEventListener('change', () => {
      window.electronAPI.profileUpdate({ autoStreamingStatus: auto.checked }).then(() => _refresh());
    });

    const cBugs = $('profileConsentBugs');
    cBugs && cBugs.addEventListener('change', () => {
      window.electronAPI.profileUpdate({ consents: { bugReports: cBugs.checked } }).then(() => _refresh());
    });
    const cAna = $('profileConsentAnalytics');
    cAna && cAna.addEventListener('change', () => {
      window.electronAPI.profileUpdate({ consents: { analytics: cAna.checked } }).then(() => _refresh());
    });

    const bSignup = $('profileBtnSignup');
    bSignup && bSignup.addEventListener('click', () => window.electronAPI.profileOpenSignup());
    const bLogin = $('profileBtnLogin');
    bLogin && bLogin.addEventListener('click', () => window.electronAPI.profileOpenLogin());
    const bWeb = $('profileBtnOpenWeb');
    bWeb && bWeb.addEventListener('click', () => window.electronAPI.profileOpenPage());
    const bLogout = $('profileBtnLogout');
    bLogout && bLogout.addEventListener('click', async () => {
      if (!confirm('Выйти из аккаунта? Локальные настройки и друзья останутся.')) return;
      await window.electronAPI.profileLogout();
      try { window.SBSounds && window.SBSounds.play('notification'); } catch (e) {}
      await _refresh();
    });

    _refreshBugStatus();
  }

  async function _refreshBugStatus() {
    const el = $('profileBugStatus');
    if (!el) return;
    try {
      const sz = await window.electronAPI.bugQueueSize();
      if (!sz) { el.innerHTML = '<span class="profile-muted">Очередь баг-репортов пуста.</span>'; return; }
      el.innerHTML = `<span>В очереди ${sz} баг-репорт(ов).</span>
        <button class="btn-link" id="bugFlushBtn">Отправить сейчас</button>
        <button class="btn-link" id="bugClearBtn">Очистить</button>`;
      $('bugFlushBtn').addEventListener('click', async () => {
        const r = await window.electronAPI.bugFlush();
        if (r && r.sent) try { window.SBSounds.play('success'); } catch (e) {}
        _refreshBugStatus();
      });
      $('bugClearBtn').addEventListener('click', async () => {
        if (!confirm('Удалить все локальные баг-репорты?')) return;
        await window.electronAPI.bugClearQueue();
        _refreshBugStatus();
      });
    } catch (e) { el.textContent = ''; }
  }

  function _escape(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  // ─── Status registry (shared with friends-ui) ───
  const STATUS_LIST   = ['online', 'offline', 'streaming', 'gaming', 'away', 'dnd', 'invisible'];
  const STATUS_ICONS  = { online: '🟢', offline: '⚫', streaming: '🔴', gaming: '🟣', away: '🟡', dnd: '🔵', invisible: '⚪' };
  const STATUS_LABELS = { online: 'Онлайн', offline: 'Не в сети', streaming: 'Стримлю', gaming: 'Играю', away: 'Отошёл', dnd: 'Не беспокоить', invisible: 'Невидимка' };

  // ─── Boot ───
  async function boot() {
    await _refresh();
    _wireWelcome();
    if (!_profile || (!_profile.registered && !_profile.hasToken)) {
      _showWelcome();
    }
    if (window.electronAPI && window.electronAPI.onProfileUpdated) {
      window.electronAPI.onProfileUpdated((p) => {
        _profile = p; _emit(); _renderSettingsCard();
        if (_profile && (_profile.registered || _profile.hasToken)) _hideWelcome();
        try { window.SBSounds && window.SBSounds.play('success'); } catch (e) {}
      });
    }
  }

  function getCached() { return _profile; }
  function onChange(cb) { if (typeof cb === 'function') _listeners.add(cb); return () => _listeners.delete(cb); }

  global.SBProfile = {
    boot,
    openEditor: () => $('settingsProfileCard') && $('settingsProfileCard').scrollIntoView({ behavior: 'smooth' }),
    getCached,
    onChange,
    STATUS_LIST,
    STATUS_ICONS,
    STATUS_LABELS,
  };
})(window);
