import type { Encryptor } from '../secretStore';

/**
 * Fake encryptor standing in for Electron's `safeStorage` in tests, per the
 * PRD's testing decision to exercise the Config Store against a temp store
 * rather than the real OS keychain. It performs a real (reversible)
 * transformation — not an identity passthrough — so tests can assert that
 * data at rest is not the plaintext secret.
 */
export function createFakeEncryptor(): Encryptor {
  return {
    isAvailable: () => true,
    encrypt: (plainText: string) => Buffer.from(Buffer.from(plainText, 'utf-8').toString('base64'), 'utf-8'),
    decrypt: (data: Buffer) => Buffer.from(data.toString('utf-8'), 'base64').toString('utf-8')
  };
}
