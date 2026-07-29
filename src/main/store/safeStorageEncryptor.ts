import { safeStorage } from 'electron';
import type { Encryptor } from './secretStore';

/**
 * Production Encryptor backed by Electron's `safeStorage` (OS-level secure
 * credential storage — Keychain on macOS, DPAPI on Windows, libsecret on
 * Linux). This is the real system boundary; SecretStore's own tests use a
 * fake Encryptor instead of exercising this file directly, since safeStorage
 * requires a ready Electron app + OS keychain access to function.
 */
export const safeStorageEncryptor: Encryptor = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plainText: string) => safeStorage.encryptString(plainText),
  decrypt: (data: Buffer) => safeStorage.decryptString(data)
};
