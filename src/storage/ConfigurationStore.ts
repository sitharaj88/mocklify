import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { MockServerConfig, MockServerConfigSchema, IConfigurationStore } from '../types/core.js';

export class ConfigurationStore implements IConfigurationStore {
  private configDir: string | undefined;
  private serversFilePath: string | undefined;
  private servers: Map<string, MockServerConfig> = new Map();

  constructor(private readonly workspaceRoot: string | undefined) {}

  async initialize(): Promise<void> {
    if (!this.workspaceRoot) {
      throw new Error('No workspace folder open');
    }

    const config = vscode.workspace.getConfiguration('mockServer');
    const configPath = config.get<string>('configPath', '.mockserver');

    this.configDir = path.join(this.workspaceRoot, configPath);
    this.serversFilePath = path.join(this.configDir, 'servers.json');

    // Ensure config directory exists
    try {
      await fs.mkdir(this.configDir, { recursive: true });
    } catch (error) {
      // Directory already exists
    }

    // Load existing configuration
    await this.load();
  }

  private async load(): Promise<void> {
    if (!this.serversFilePath) {
      return;
    }

    try {
      const content = await fs.readFile(this.serversFilePath, 'utf-8');
      const data = JSON.parse(content);

      if (Array.isArray(data.servers)) {
        this.servers.clear();
        for (const serverData of data.servers) {
          try {
            const validated = MockServerConfigSchema.parse(serverData);
            this.servers.set(validated.id, validated);
          } catch (error) {
            console.error(`Invalid server config: ${serverData.id}`, error);
          }
        }
      }
    } catch (error) {
      // File doesn't exist or is invalid, start with empty config
      this.servers.clear();
    }
  }

  private async save(): Promise<void> {
    if (!this.serversFilePath || !this.configDir) {
      throw new Error('Configuration store not initialized');
    }

    const data = {
      version: '1.0',
      servers: Array.from(this.servers.values()),
    };

    await fs.mkdir(this.configDir, { recursive: true });
    await fs.writeFile(this.serversFilePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async getServers(): Promise<MockServerConfig[]> {
    return Array.from(this.servers.values());
  }

  async getServer(id: string): Promise<MockServerConfig | undefined> {
    return this.servers.get(id);
  }

  async saveServer(config: MockServerConfig): Promise<void> {
    // Validate the config
    const validated = MockServerConfigSchema.parse(config);
    validated.updatedAt = new Date().toISOString();

    if (!this.servers.has(validated.id)) {
      validated.createdAt = new Date().toISOString();
    }

    this.servers.set(validated.id, validated);
    await this.save();
  }

  async deleteServer(id: string): Promise<void> {
    if (this.servers.delete(id)) {
      await this.save();
    }
  }

  getConfigDir(): string | undefined {
    return this.configDir;
  }
}
