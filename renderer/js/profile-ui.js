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

  // Preset avatars (emoji-based, rendered large)
  const _PRESET_AVATARS = ['🐱','🐶','🦊','🐻','🐼','🦁','🐸','🦉','🐺','🐲','🦄','🐧','🎭','🎨','🎬','🎵','👾','🤖','🚀','⚡','🔥','💎','🌟','🍀'];

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
      // Save consent async, don't wait — form must open immediately
      window.electronAPI.profileUpdate({
        consents: { bugReports: !!(cbBugs && cbBugs.checked), tos: true },
      }).catch(() => {});
      _showInlineForm('register');
    });

    btnLogin && btnLogin.addEventListener('click', () => {
      // Save consent async, don't wait — form must open immediately
      window.electronAPI.profileUpdate({
        consents: { bugReports: !!(cbBugs && cbBugs.checked), tos: !!(cbTos && cbTos.checked) },
      }).catch(() => {});
      _showInlineForm('login');
    });

    // OAuth buttons on welcome overlay — use {once:true} to prevent duplicate listeners
    // when _wireWelcome() is called multiple times (e.g. after "back" click)
    const btnGoogle = $('welcomeBtnGoogle');
    if (btnGoogle && !btnGoogle._oauthWired) {
      btnGoogle._oauthWired = true;
      btnGoogle.addEventListener('click', () => {
        window.electronAPI.profileOpenOAuth('google');
        _showSignupHint();
      });
    }
    const btnVK = $('welcomeBtnVK');
    if (btnVK && !btnVK._oauthWired) {
      btnVK._oauthWired = true;
      btnVK.addEventListener('click', () => {
        window.electronAPI.profileOpenOAuth('vk');
        _showSignupHint();
      });
    }

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

  // ─── Inline login/register form (no browser) ───
  function _showInlineForm(mode) {
    const welcomeEl = $('welcomeOverlay');
    const settingsEl = $('settingsProfileCard');

    // If welcome overlay is visible, insert form there; otherwise settings card
    const isWelcome = (welcomeEl && welcomeEl.style.display !== 'none');
    const card = isWelcome ? welcomeEl : settingsEl;
    if (!card) return;

    const isReg = mode === 'register';

    // Store original content so we can restore on "Back"
    const originalHTML = card.getAttribute('data-orig-html');
    if (!originalHTML) {
      card.setAttribute('data-orig-html', card.innerHTML);
    }

    card.innerHTML = `
      <div class="welcome-modal glass">
        <div class="profile-inline-form">
          <h3 style="margin-bottom:0.5rem">${isReg ? 'Регистрация' : 'Вход в аккаунт'}</h3>
          <p style="color:var(--text2);font-size:0.85rem;margin-bottom:1rem">
            ${isReg ? 'Создайте аккаунт для P2P со-стрима и друзей' : 'Введите данные для входа'}
          </p>
          <div id="inlineFormError" style="display:none;color:var(--error);font-size:0.85rem;margin-bottom:0.75rem"></div>
          ${isReg ? `
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="inlineEmail" placeholder="you@example.com" />
            </div>
            <div class="form-group">
              <label>Имя пользователя</label>
              <input type="text" id="inlineUsername" placeholder="streamer42" maxlength="24" />
            </div>
          ` : `
            <div class="form-group">
              <label>Email или имя пользователя</label>
              <input type="text" id="inlineLogin" placeholder="you@example.com" />
            </div>
          `}
          <div class="form-group">
            <label>Пароль</label>
            <input type="password" id="inlinePassword" placeholder="Минимум 8 символов" />
          </div>
          <div class="profile-actions" style="margin-top:1rem">
            <button class="btn btn-accent" id="inlineSubmit" style="width:100%">${isReg ? 'Создать аккаунт' : 'Войти'}</button>
            <div style="display:flex;gap:0.5rem;margin-top:0.75rem">
              <button class="btn" id="inlineGoogle" style="flex:1;font-size:0.82rem">Google</button>
              <button class="btn" id="inlineVK" style="flex:1;font-size:0.82rem">VK</button>
            </div>
            <button class="btn-link" id="inlineBack" style="margin-top:0.5rem;font-size:0.85rem">← Назад</button>
          </div>
        </div>
      </div>
    `;

    const errEl = $('inlineFormError');
    const submitBtn = $('inlineSubmit');
    const backBtn = $('inlineBack');
    const googleBtn = $('inlineGoogle');
    const vkBtn = $('inlineVK');

    backBtn && backBtn.addEventListener('click', () => {
      const saved = card.getAttribute('data-orig-html');
      if (saved) {
        card.innerHTML = saved;
        card.removeAttribute('data-orig-html');
        if (isWelcome) _wireWelcome();
      } else {
        _refresh();
      }
    });

    googleBtn && googleBtn.addEventListener('click', () => {
      window.electronAPI.profileOpenOAuth('google');
      _showSignupHint();
    });
    vkBtn && vkBtn.addEventListener('click', () => {
      window.electronAPI.profileOpenOAuth('vk');
      _showSignupHint();
    });

    submitBtn && submitBtn.addEventListener('click', async () => {
      submitBtn.disabled = true;
      submitBtn.textContent = isReg ? 'Регистрация...' : 'Вход...';
      errEl.style.display = 'none';

      let result;
      if (isReg) {
        const email = ($('inlineEmail') || {}).value || '';
        const username = ($('inlineUsername') || {}).value || '';
        const password = ($('inlinePassword') || {}).value || '';
        if (!email || !username || !password || password.length < 8) {
          errEl.textContent = 'Заполните все поля (пароль от 8 символов)';
          errEl.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Создать аккаунт';
          return;
        }
        result = await window.electronAPI.profileRegister({ email, username, password });
      } else {
        const login = ($('inlineLogin') || {}).value || '';
        const password = ($('inlinePassword') || {}).value || '';
        if (!login || !password) {
          errEl.textContent = 'Введите логин и пароль';
          errEl.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Войти';
          return;
        }
        result = await window.electronAPI.profileLogin({ login, password });
      }

      if (result && result.success) {
        try { window.SBSounds && window.SBSounds.play('success'); } catch (e) {}
        _hideWelcome();
        await _refresh();
      } else {
        errEl.textContent = (result && result.error) || 'Ошибка';
        errEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = isReg ? 'Создать аккаунт' : 'Войти';
        try { window.SBSounds && window.SBSounds.play('error'); } catch (e) {}
      }
    });
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
          ? (_profile.avatar.startsWith('http') || _profile.avatar.startsWith('/') || _profile.avatar.startsWith('avatar:')
            ? `<img src="${_escape(_profile.avatar)}" alt=""/>`
            : _escape(_profile.avatar))
          : `<span class="avatar-initials">${initials}</span>`}</div>
        <div class="profile-meta">
          <div class="profile-nick"><input type="text" id="profileNickInput" value="${_escape(_profile.nickname || '')}" maxlength="32" placeholder="Ник"/></div>
          <div class="profile-email">${_profile.email ? _escape(_profile.email) : '<span class="profile-muted">(локальный аккаунт)</span>'}</div>
          <div class="profile-id">ID: ${_escape(_profile.serverId || _profile.id || '—')}</div>
        </div>
      </div>
      <div class="form-group">
        <label>Аватар</label>
        <div class="avatar-picker" id="avatarPicker">
          <div class="avatar-presets" id="avatarPresets">
            ${_PRESET_AVATARS.map(a => `<button class="avatar-preset${_profile.avatar===a?' selected':''}" data-avatar="${a}">${a}</button>`).join('')}
          </div>
          <div class="avatar-custom">
            <label class="btn" style="font-size:0.8rem;padding:0.3rem 0.6rem;cursor:pointer">Выбрать файл<input type="file" id="avatarFileInput" accept="image/jpeg,image/png,image/gif,image/webp" style="display:none"/></label>
            ${_profile.avatar && !_PRESET_AVATARS.includes(_profile.avatar) ? '<button class="btn" id="avatarRemoveBtn" style="font-size:0.75rem;padding:0.2rem 0.5rem;color:var(--danger)">Удалить</button>' : ''}
          </div>
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
          ? `<button class="btn" id="profileBtnChangePassword" style="font-size:0.8rem">Сменить пароль</button>
             <button class="btn" id="profileBtnOpenWeb">Открыть профиль на сайте</button>
             <button class="btn" id="profileBtnLogout">Выйти</button>`
          : `<button class="btn btn-accent" id="profileBtnSignup">Регистрация</button>
             <button class="btn" id="profileBtnLogin">Войти</button>
             <button class="btn-link" id="profileBtnOpenSite" style="margin-top:0.5rem;font-size:0.8rem;color:var(--accent)">или через сайт →</button>`
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

    // Avatar preset buttons
    const presetContainer = $('avatarPresets');
    if (presetContainer) {
      presetContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.avatar-preset');
        if (!btn) return;
        const emoji = btn.dataset.avatar;
        window.electronAPI.profileUpdate({ avatar: emoji }).then(() => {
          try { window.SBSounds && window.SBSounds.play('click'); } catch (_) {}
          _refresh();
        });
      });
    }

    // Avatar file upload
    const fileInput = $('avatarFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) { _toast('Файл слишком большой (макс. 2 МБ)'); return; }
        if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) { _toast('Только JPG, PNG, GIF, WebP'); return; }
        _toast('Загрузка аватара...');
        try {
          const buf = await file.arrayBuffer();
          const u8 = new Uint8Array(buf);
          console.log('[SBProfile] file read:', file.name, file.type, u8.length, 'bytes');
          const payload = { buffer: u8, name: file.name, type: file.type, size: file.size };
          console.log('[SBProfile] sending payload, keys:', Object.keys(payload), 'buffer type:', u8.constructor.name);
          const result = await window.electronAPI.profileUploadAvatar(payload);
          console.log('[SBProfile] upload result:', JSON.stringify(result));
          if (result && result.error) { _toast('Ошибка: ' + result.error); return; }
          if (result && result.avatarUrl) { _toast('Аватар обновлён'); await _refresh(); }
          else { _toast('Ошибка загрузки аватара'); }
        } catch (err) {
          console.warn('[SBProfile] avatar upload error:', err);
          _toast('Ошибка: ' + (err.message || err));
        }
      });
    }

    // Avatar remove button
    const removeBtn = $('avatarRemoveBtn');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        window.electronAPI.profileUpdate({ avatar: '' }).then(() => _refresh());
      });
    }

    const bSignup = $('profileBtnSignup');
    bSignup && bSignup.addEventListener('click', () => _showInlineForm('register'));
    const bLogin = $('profileBtnLogin');
    bLogin && bLogin.addEventListener('click', () => _showInlineForm('login'));
    const bSite = $('profileBtnOpenSite');
    bSite && bSite.addEventListener('click', () => window.electronAPI.profileOpenLogin());
    const bWeb = $('profileBtnOpenWeb');
    bWeb && bWeb.addEventListener('click', () => window.electronAPI.profileOpenPage());

    // OAuth buttons in settings card (for unregistered users)
    const bGoogle = $('profileBtnGoogle');
    bGoogle && bGoogle.addEventListener('click', () => window.electronAPI.profileOpenOAuth('google'));
    const bVK = $('profileBtnVK');
    bVK && bVK.addEventListener('click', () => window.electronAPI.profileOpenOAuth('vk'));

    const bChangePwd = $('profileBtnChangePassword');
    bChangePwd && bChangePwd.addEventListener('click', () => _showChangePasswordForm());

    const bLogout = $('profileBtnLogout');
    bLogout && bLogout.addEventListener('click', async () => {
      if (!confirm('Выйти из аккаунта? Друзья и чаты этого аккаунта будут очищены.')) return;
      await window.electronAPI.profileLogout();
      try { window.SBSounds && window.SBSounds.play('notification'); } catch (e) {}
      // Clear friends cache on logout
      try { window.SBFriends && window.SBFriends.reset(); } catch (e) {}
      // Clear any stale form state
      const overlay = $('welcomeOverlay');
      if (overlay) overlay.removeAttribute('data-orig-html');
      const sCard = $('settingsProfileCard');
      if (sCard) sCard.removeAttribute('data-orig-html');
      await _refresh();
      _showWelcome();
      _wireWelcome();
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

  async function _showChangePasswordForm() {
    const currentPwd = prompt('Текущий пароль:');
    if (!currentPwd) return;
    const newPwd = prompt('Новый пароль (минимум 8 символов):');
    if (!newPwd) return;
    if (newPwd.length < 8) { _toast('Пароль должен быть минимум 8 символов'); return; }
    try {
      const result = await window.electronAPI.profileChangePassword(currentPwd, newPwd);
      if (result && result.error) { _toast('Ошибка: ' + result.error); }
      else { _toast('Пароль изменён!'); }
    } catch (err) {
      _toast('Ошибка: ' + (err.message || err));
    }
  }

  function _escape(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function _toast(text) {
    // Use app.js msg() if available (exported to window)
    if (typeof window.msg === 'function') { window.msg(text); return; }
    // Fallback: create own notification
    const container = document.getElementById('notifications');
    if (container) {
      const e = document.createElement('div');
      e.className = 'notification info';
      e.textContent = text;
      container.appendChild(e);
      setTimeout(() => { e.style.opacity = '0'; e.style.transition = '.4s'; setTimeout(() => e.remove(), 400); }, 2500);
      return;
    }
    console.log('[SBProfile]', text);
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
