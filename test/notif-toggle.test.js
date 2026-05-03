// StreamBro — test for notification toggle buttons
// Simulates DOM and clicks to verify ON↔OFF cycling works.

const assert = require('assert');

function setupDOM() {
  // Minimal jsdom-like stubs
  const elements = new Map();
  global.document = {
    getElementById: (id) => elements.get(id) || null,
    createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} }, addEventListener: () => {} }),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  global.window = global;

  // Build a button mock
  function makeBtn(id) {
    const listeners = [];
    const attrs = {};
    const btn = {
      id,
      style: {},
      dataset: {},
      textContent: '',
      setAttribute(name, val) {
        attrs[name] = val;
        if (name.startsWith('data-')) {
          const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          this.dataset[key] = val;
        }
      },
      getAttribute(name) { return attrs[name]; },
      addEventListener: (type, fn) => { listeners.push({ type, fn }); },
      removeEventListener: () => {},
      cloneNode: () => makeBtn(id),
      parentNode: null,
      click() {
        for (const l of listeners) {
          if (l.type === 'click') l.fn({ preventDefault: () => {}, stopPropagation: () => {} });
        }
      },
      _listeners: listeners,
    };
    btn.parentNode = { replaceChild: (newEl, oldEl) => { elements.set(id, newEl); } };
    return btn;
  }
  elements.set('globalNotifSound', makeBtn('globalNotifSound'));
  elements.set('globalNotifBadge', makeBtn('globalNotifBadge'));
  elements.set('friendsBadge', { textContent: '', style: {} });
  elements.set('friendsList', { innerHTML: '', querySelectorAll: () => [] });

  // Mock window.S settings
  global.S = { settings: { friends: {} } };
  global._scheduleSettingsSave = () => { S._saveCount = (S._saveCount || 0) + 1; };
  global.window._scheduleSettingsSave = global._scheduleSettingsSave;

  global.window.electronAPI = {
    friendsList: async () => [],
    friendsUnread: async () => ({}),
    friendsSync: async () => {},
    profileUpdate: async () => {},
    friendsMarkRead: async () => {},
    onFriendsChanged: () => {},
    onFriendsMessage: () => {},
  };
  global.window.SBProfile = { onChange: () => {}, getCached: () => null };

  return elements;
}

(async () => {
  const elements = setupDOM();
  // Load friends-ui.js
  delete require.cache[require.resolve('../renderer/js/friends-ui.js')];
  require('../renderer/js/friends-ui.js');

  await window.SBFriends.boot();

  const soundBtn = elements.get('globalNotifSound');
  const badgeBtn = elements.get('globalNotifBadge');

  assert(soundBtn, 'sound button exists');
  assert(badgeBtn, 'badge button exists');

  // Initial state should be ON (default)
  assert.strictEqual(soundBtn.dataset.state, '1', 'initial sound state ON');
  console.log('  ok: initial sound = ON');

  // Click 1: toggle OFF
  soundBtn.click();
  assert.strictEqual(S.settings.friends.notifications.sound, false, 'sound saved as false after 1st click');
  assert.strictEqual(soundBtn.dataset.state, '0', 'sound button shows OFF after 1st click');
  console.log('  ok: click 1 → OFF');

  // Click 2: toggle back ON
  soundBtn.click();
  assert.strictEqual(S.settings.friends.notifications.sound, true, 'sound saved as true after 2nd click');
  assert.strictEqual(soundBtn.dataset.state, '1', 'sound button shows ON after 2nd click');
  console.log('  ok: click 2 → ON');

  // Click 3: toggle OFF again
  soundBtn.click();
  assert.strictEqual(S.settings.friends.notifications.sound, false, 'sound saved as false after 3rd click');
  assert.strictEqual(soundBtn.dataset.state, '0', 'sound button shows OFF after 3rd click');
  console.log('  ok: click 3 → OFF');

  // Click 4: toggle back ON
  soundBtn.click();
  assert.strictEqual(S.settings.friends.notifications.sound, true, '4th click ON');
  assert.strictEqual(soundBtn.dataset.state, '1', '4th click button ON');
  console.log('  ok: click 4 → ON (full cycle works)');

  // Same for badge button
  badgeBtn.click(); // OFF
  assert.strictEqual(S.settings.friends.notifications.badge, false);
  badgeBtn.click(); // ON
  assert.strictEqual(S.settings.friends.notifications.badge, true);
  console.log('  ok: badge full cycle works');

  // Verify settings save was called
  assert(S._saveCount >= 4, '_scheduleSettingsSave called for each toggle');
  console.log('  ok: settings save triggered (' + S._saveCount + ' times)');

  console.log('\n## notif-toggle: all tests passed');
  // Cleanup setInterval timers from boot()
  if (window.SBFriends && window.SBFriends.reset) window.SBFriends.reset();
  process.exit(0);
})().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
