import { app } from 'electron';
import path from 'node:path';

/**
 * secrets.enc and config.json intentionally live side by side in userData
 * but are never read/written by the same module — see SecretStore vs
 * ConfigStore and secretConfigIsolation.test.ts.
 */
export function getSecretsFilePath(): string {
  return path.join(app.getPath('userData'), 'secrets.enc');
}

export function getConfigFilePath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}
