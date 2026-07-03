import * as vscode from 'vscode';
import { AiProviderId } from './types.js';

const KEY_PREFIX = 'mocklify.apiKey.';

/**
 * Stores provider API keys in VS Code's encrypted SecretStorage —
 * never in settings.json or on disk in plain text.
 */
export class ApiKeyManager {
  constructor(private secrets: vscode.SecretStorage) {}

  async getKey(provider: AiProviderId): Promise<string | undefined> {
    return this.secrets.get(KEY_PREFIX + provider);
  }

  async setKey(provider: AiProviderId, key: string): Promise<void> {
    await this.secrets.store(KEY_PREFIX + provider, key);
  }

  async deleteKey(provider: AiProviderId): Promise<void> {
    await this.secrets.delete(KEY_PREFIX + provider);
  }

  async hasKey(provider: AiProviderId): Promise<boolean> {
    return (await this.getKey(provider)) !== undefined;
  }
}
