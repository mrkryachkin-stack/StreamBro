// StreamBro — cloud settings sync (main process)
// Encrypts settings blob with AES-256-GCM, uploads to server, downloads and decrypts.
// Sync is manual (user-triggered or on login) — no auto-sync to avoid conflicts.

const crypto = require('crypto');
const serverApi = require('./server-api');
const profileManager = require('./profile-manager');

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32; // 256 bits
const IV_LEN = 12;  // 96 bits for GCM
const TAG_LEN = 16;

// Derive a 256-bit key from the user's JWT token (deterministic, same token = same key)
function _deriveKey() {
  const token = profileManager.getToken();
  if (!token) return null;
  // Use SHA-256 of token as key — token is already secret (encrypted in safeStorage)
  return crypto.createHash('sha256').update(token).digest();
}

function encrypt(data) {
  const key = _deriveKey();
  if (!key) return null;

  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const json = JSON.stringify(data);
  let enc = cipher.update(json, 'utf8', 'base64');
  enc += cipher.final('base64');
  const tag = cipher.getAuthTag();

  // Combine: enc + tag (appended), IV separate
  return {
    encryptedData: enc + tag.toString('base64'),
    iv: iv.toString('base64'),
  };
}

function decrypt(blob) {
  const key = _deriveKey();
  if (!key) return null;

  try {
    const iv = Buffer.from(blob.iv, 'base64');
    // Split encrypted data from auth tag
    const encWithTag = blob.encryptedData;
    const tagB64 = encWithTag.slice(-24); // 16 bytes = 24 base64 chars
    const encData = encWithTag.slice(0, -24);
    const tag = Buffer.from(tagB64, 'base64');

    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    let dec = decipher.update(encData, 'base64', 'utf8');
    dec += decipher.final('utf8');

    return JSON.parse(dec);
  } catch (e) {
    console.error('[CloudSync] Decrypt failed:', e.message);
    return null;
  }
}

// ─── Public API ───

async function upload(settings) {
  const encrypted = encrypt(settings);
  if (!encrypted) return { ok: false, error: 'encryption failed (not authenticated?)' };

  return serverApi.cloudSettingsPut(encrypted);
}

async function download() {
  const res = await serverApi.cloudSettingsGet();
  if (!res.ok) return res;
  if (!res.data || !res.data.exists) return { ok: true, exists: false };

  const decrypted = decrypt(res.data);
  if (!decrypted) return { ok: false, error: 'decryption failed' };

  return { ok: true, exists: true, data: decrypted, version: res.data.version, updatedAt: res.data.updatedAt };
}

async function remove() {
  return serverApi.cloudSettingsDelete();
}

module.exports = { upload, download, remove, encrypt, decrypt };
