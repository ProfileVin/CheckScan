const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

function settingsFilePath() {
  return path.join(app.getPath('userData'), 'secure-settings.json');
}

function readRaw() {
  try {
    return JSON.parse(fs.readFileSync(settingsFilePath(), 'utf8'));
  } catch {
    return {};
  }
}

/** Encrypts and saves the Anthropic API key using the OS keychain (DPAPI on Windows). */
function saveApiKey(key) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level encryption is not available on this machine.');
  }
  const encrypted = safeStorage.encryptString(key).toString('base64');
  const settings = readRaw();
  settings.encryptedApiKey = encrypted;
  fs.writeFileSync(settingsFilePath(), JSON.stringify(settings));
}

/** Returns the decrypted API key, or null if none has been saved (or decryption is unavailable). */
function getApiKey() {
  const settings = readRaw();
  if (!settings.encryptedApiKey || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(settings.encryptedApiKey, 'base64'));
  } catch {
    return null;
  }
}

function hasApiKey() {
  return Boolean(readRaw().encryptedApiKey);
}

module.exports = { saveApiKey, getApiKey, hasApiKey };
