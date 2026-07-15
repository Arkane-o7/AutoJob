(function (root) {
  "use strict";

  const ApplyOS = root.ApplyOS = root.ApplyOS || {};
  const FORMAT = "applyos-encrypted-backup";
  const PAYLOAD_FORMAT = "applyos-data";
  const BACKUP_VERSION = 1;
  const ITERATIONS = 310000;
  const CHECKPOINT_KEY = "applyos_restore_checkpoint";
  const EXACT_KEYS = new Set([ApplyOS.STORAGE_KEY || "applyos_state", ApplyOS.PROFILE_KEY || "profile", "profilesIndex", "applyos_graph", "ollamaConfig"]);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function isBackupKey(key) {
    return EXACT_KEYS.has(key) || /^profile_[a-z0-9_:-]+$/i.test(key);
  }

  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    root.crypto.getRandomValues(bytes);
    return bytes;
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    }
    return root.btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = root.atob(String(value || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function safeClone(value, depth = 0) {
    if (depth > 40) throw new Error("Backup data is nested too deeply.");
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
    if (Array.isArray(value)) return value.map((item) => safeClone(item, depth + 1));
    if (!value || typeof value !== "object") return null;
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) continue;
      result[key] = safeClone(item, depth + 1);
    }
    return result;
  }

  function validateSnapshot(input) {
    if (!input || typeof input !== "object" || input.format !== PAYLOAD_FORMAT || input.version !== BACKUP_VERSION || !input.data || typeof input.data !== "object") {
      throw new Error("This is not a supported ApplyOS backup.");
    }
    const data = {};
    for (const [key, value] of Object.entries(input.data)) {
      if (isBackupKey(key)) data[key] = safeClone(value);
    }
    const state = data[ApplyOS.STORAGE_KEY || "applyos_state"];
    if (state?.schema_version > ApplyOS.SCHEMA_VERSION) throw new Error("This backup was created by a newer ApplyOS version. Update the extension before restoring it.");
    return {
      format: PAYLOAD_FORMAT,
      version: BACKUP_VERSION,
      created_at: typeof input.created_at === "string" ? input.created_at : new Date().toISOString(),
      extension_version: typeof input.extension_version === "string" ? input.extension_version : "unknown",
      data
    };
  }

  async function deriveKey(password, salt, iterations, usage) {
    const material = await root.crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
    return root.crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, [usage]);
  }

  async function replaceBackupData(snapshot) {
    const stored = await chrome.storage.local.get(null);
    const oldKeys = Object.keys(stored).filter(isBackupKey);
    if (oldKeys.length) await chrome.storage.local.remove(oldKeys);
    await chrome.storage.local.set(snapshot.data);
    await ApplyOS.ensureProfiles?.();
    await ApplyOS.ensureState?.();
    await ApplyOS.ensureGraph?.();
  }

  ApplyOS.createBackupSnapshot = function createBackupSnapshot(stored = {}, extensionVersion = "unknown", createdAt = new Date().toISOString()) {
    const data = {};
    for (const [key, value] of Object.entries(stored || {})) {
      if (isBackupKey(key)) data[key] = safeClone(value);
    }
    return validateSnapshot({ format: PAYLOAD_FORMAT, version: BACKUP_VERSION, created_at: createdAt, extension_version: String(extensionVersion || "unknown"), data });
  };

  ApplyOS.backupSummary = function backupSummary(snapshot) {
    const safe = validateSnapshot(snapshot);
    const state = safe.data[ApplyOS.STORAGE_KEY || "applyos_state"] || {};
    const index = safe.data.profilesIndex || {};
    return {
      created_at: safe.created_at,
      extension_version: safe.extension_version,
      profiles: Array.isArray(index.profiles) ? index.profiles.length : Object.keys(safe.data).filter((key) => key.startsWith("profile_")).length,
      applications: Array.isArray(state.applications) ? state.applications.length : 0,
      contacts: Array.isArray(state.contacts) ? state.contacts.length : 0,
      interviews: Array.isArray(state.interviews) ? state.interviews.length : 0,
      answers: (Array.isArray(state.answer_memory) ? state.answer_memory.length : 0) + (Array.isArray(state.learned_answers) ? state.learned_answers.length : 0)
    };
  };

  ApplyOS.encryptBackup = async function encryptBackup(snapshot, password) {
    if (String(password || "").length < 10) throw new Error("Use a backup password with at least 10 characters.");
    const safe = validateSnapshot(snapshot);
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await deriveKey(String(password), salt, ITERATIONS, "encrypt");
    const plaintext = encoder.encode(JSON.stringify(safe));
    const ciphertext = new Uint8Array(await root.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
    return JSON.stringify({
      format: FORMAT,
      version: BACKUP_VERSION,
      created_at: safe.created_at,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: bytesToBase64(salt) },
      cipher: { name: "AES-GCM", iv: bytesToBase64(iv) },
      ciphertext: bytesToBase64(ciphertext)
    });
  };

  ApplyOS.decryptBackup = async function decryptBackup(serialized, password) {
    let envelope;
    try { envelope = typeof serialized === "string" ? JSON.parse(serialized) : serialized; }
    catch { throw new Error("The selected file is not valid JSON."); }
    if (envelope?.format !== FORMAT || envelope.version !== BACKUP_VERSION || envelope.kdf?.name !== "PBKDF2" || envelope.kdf?.hash !== "SHA-256" || envelope.cipher?.name !== "AES-GCM") {
      throw new Error("This is not a supported encrypted ApplyOS backup.");
    }
    const iterations = Number(envelope.kdf.iterations);
    if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) throw new Error("The backup uses unsupported encryption settings.");
    let plaintext;
    try {
      const salt = base64ToBytes(envelope.kdf.salt);
      const iv = base64ToBytes(envelope.cipher.iv);
      if (salt.length !== 16 || iv.length !== 12) throw new Error("Invalid encryption metadata");
      const key = await deriveKey(String(password || ""), salt, iterations, "decrypt");
      plaintext = await root.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, base64ToBytes(envelope.ciphertext));
    } catch {
      throw new Error("Could not decrypt this backup. Check the password and file.");
    }
    let payload;
    try { payload = JSON.parse(decoder.decode(plaintext)); }
    catch { throw new Error("The decrypted backup payload is invalid."); }
    return validateSnapshot(payload);
  };

  ApplyOS.exportEncryptedBackup = async function exportEncryptedBackup(password, extensionVersion = "unknown") {
    const stored = await chrome.storage.local.get(null);
    const snapshot = ApplyOS.createBackupSnapshot(stored, extensionVersion);
    return { serialized: await ApplyOS.encryptBackup(snapshot, password), summary: ApplyOS.backupSummary(snapshot) };
  };

  ApplyOS.restoreBackup = async function restoreBackup(snapshot) {
    const safe = validateSnapshot(snapshot);
    const current = ApplyOS.createBackupSnapshot(await chrome.storage.local.get(null), root.chrome?.runtime?.getManifest?.().version || "unknown");
    await chrome.storage.local.set({ [CHECKPOINT_KEY]: current });
    try {
      await replaceBackupData(safe);
      return ApplyOS.backupSummary(safe);
    } catch (error) {
      await replaceBackupData(current);
      await chrome.storage.local.remove(CHECKPOINT_KEY);
      throw error;
    }
  };

  ApplyOS.hasRestoreCheckpoint = async function hasRestoreCheckpoint() {
    const stored = await chrome.storage.local.get(CHECKPOINT_KEY);
    return Boolean(stored[CHECKPOINT_KEY]);
  };

  ApplyOS.undoLastRestore = async function undoLastRestore() {
    const stored = await chrome.storage.local.get(CHECKPOINT_KEY);
    if (!stored[CHECKPOINT_KEY]) throw new Error("No restore checkpoint is available.");
    const checkpoint = validateSnapshot(stored[CHECKPOINT_KEY]);
    await replaceBackupData(checkpoint);
    await chrome.storage.local.remove(CHECKPOINT_KEY);
    return ApplyOS.backupSummary(checkpoint);
  };
})(globalThis);
