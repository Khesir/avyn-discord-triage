import fs from 'node:fs';
import path from 'node:path';

/**
 * Boundary abstraction over Electron's `safeStorage` API. Production code
 * wires this to the real OS-level secure storage (see safeStorageEncryptor.ts);
 * tests supply a fake so the Config Store's own logic can be verified without
 * touching the real OS keychain.
 */
export interface Encryptor {
  isAvailable(): boolean;
  encrypt(plainText: string): Buffer;
  decrypt(data: Buffer): string;
}

export const SECRET_KEYS = ['discordBotToken', 'githubPat'] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];
export type SecretValues = Partial<Record<SecretKey, string>>;

/**
 * Persists secrets (Discord bot token, GitHub PAT) to an encrypted file,
 * fully separate from the non-secret ConfigStore's plain JSON file.
 */
export class SecretStore {
  constructor(
    private readonly filePath: string,
    private readonly encryptor: Encryptor
  ) {}

  getAll(): SecretValues {
    if (!fs.existsSync(this.filePath)) {
      return {};
    }

    const raw = fs.readFileSync(this.filePath);
    if (raw.length === 0) {
      return {};
    }

    try {
      const decrypted = this.encryptor.decrypt(raw);
      return JSON.parse(decrypted) as SecretValues;
    } catch {
      return {};
    }
  }

  get(key: SecretKey): string | undefined {
    return this.getAll()[key];
  }

  setSecret(key: SecretKey, value: string): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Cannot save an empty value for "${key}".`);
    }

    const next: SecretValues = { ...this.getAll(), [key]: value };
    const encrypted = this.encryptor.encrypt(JSON.stringify(next));

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, encrypted);
  }
}
