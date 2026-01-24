import * as fs from 'fs/promises';
import * as path from 'path';
import {
  DatabaseConnection,
  DatabaseType,
  JsonDbConfig,
  SqliteDbConfig,
  MongoDbConfig,
  SqlDbConfig,
} from '../types/core.js';

export interface DatabaseQuery {
  operation: 'find' | 'findOne' | 'insert' | 'update' | 'delete' | 'query';
  collection?: string;
  table?: string;
  filter?: Record<string, unknown>;
  data?: Record<string, unknown> | Record<string, unknown>[];
  query?: string;
  limit?: number;
  skip?: number;
  sort?: Record<string, 1 | -1>;
}

export interface DatabaseResult {
  success: boolean;
  data?: unknown;
  affected?: number;
  insertedId?: string;
  error?: string;
}

export interface IDatabaseAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  execute(query: DatabaseQuery): Promise<DatabaseResult>;
  isConnected(): boolean;
}

/**
 * JSON File Database Adapter
 */
export class JsonDatabaseAdapter implements IDatabaseAdapter {
  private config: JsonDbConfig;
  private data: Map<string, unknown[]> = new Map();
  private connected = false;
  private workspaceRoot: string;

  constructor(config: JsonDbConfig, workspaceRoot: string) {
    this.config = config;
    this.workspaceRoot = workspaceRoot;
  }

  async connect(): Promise<void> {
    const filePath = path.isAbsolute(this.config.filePath)
      ? this.config.filePath
      : path.join(this.workspaceRoot, this.config.filePath);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      if (typeof parsed === 'object' && parsed !== null) {
        for (const [key, value] of Object.entries(parsed)) {
          if (Array.isArray(value)) {
            this.data.set(key, value);
          }
        }
      }

      this.connected = true;
    } catch (error) {
      // File doesn't exist, initialize empty
      for (const collection of this.config.collections) {
        this.data.set(collection, []);
      }
      this.connected = true;
    }
  }

  async disconnect(): Promise<void> {
    await this.save();
    this.data.clear();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async execute(query: DatabaseQuery): Promise<DatabaseResult> {
    if (!this.connected) {
      return { success: false, error: 'Not connected' };
    }

    const collectionName = query.collection || query.table || '';
    let collection = this.data.get(collectionName);

    if (!collection && ['find', 'findOne', 'update', 'delete'].includes(query.operation)) {
      return { success: false, error: `Collection "${collectionName}" not found` };
    }

    if (!collection) {
      collection = [];
      this.data.set(collectionName, collection);
    }

    try {
      switch (query.operation) {
        case 'find': {
          let results = this.filterItems(collection, query.filter);
          if (query.sort) results = this.sortItems(results, query.sort);
          if (query.skip) results = results.slice(query.skip);
          if (query.limit) results = results.slice(0, query.limit);
          return { success: true, data: results };
        }

        case 'findOne': {
          const results = this.filterItems(collection, query.filter);
          return { success: true, data: results[0] || null };
        }

        case 'insert': {
          const items = Array.isArray(query.data) ? query.data : [query.data];
          const inserted: unknown[] = [];

          for (const item of items) {
            const newItem = {
              id: this.generateId(),
              ...item,
              createdAt: new Date().toISOString(),
            };
            collection.push(newItem);
            inserted.push(newItem);
          }

          await this.save();
          return {
            success: true,
            data: inserted.length === 1 ? inserted[0] : inserted,
            insertedId: (inserted[0] as Record<string, unknown>)?.id as string,
          };
        }

        case 'update': {
          const matches = this.filterItems(collection, query.filter);
          let affected = 0;

          for (const item of matches) {
            if (typeof item === 'object' && item !== null) {
              Object.assign(item as object, query.data || {}, { updatedAt: new Date().toISOString() });
              affected++;
            }
          }

          await this.save();
          return { success: true, affected, data: matches };
        }

        case 'delete': {
          const before = collection.length;
          const filtered = collection.filter((item) => !this.matchesFilter(item, query.filter));
          this.data.set(collectionName, filtered);

          await this.save();
          return { success: true, affected: before - filtered.length };
        }

        case 'query': {
          // For JSON DB, query is just a collection name
          return { success: true, data: collection };
        }

        default:
          return { success: false, error: `Unknown operation: ${query.operation}` };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private filterItems(items: unknown[], filter?: Record<string, unknown>): unknown[] {
    if (!filter || Object.keys(filter).length === 0) {
      return [...items];
    }

    return items.filter((item) => this.matchesFilter(item, filter));
  }

  private matchesFilter(item: unknown, filter?: Record<string, unknown>): boolean {
    if (!filter || typeof item !== 'object' || item === null) {
      return true;
    }

    const record = item as Record<string, unknown>;

    for (const [key, value] of Object.entries(filter)) {
      if (record[key] !== value) {
        return false;
      }
    }

    return true;
  }

  private sortItems(items: unknown[], sort: Record<string, 1 | -1>): unknown[] {
    return [...items].sort((a, b) => {
      const aRecord = a as Record<string, unknown>;
      const bRecord = b as Record<string, unknown>;

      for (const [key, direction] of Object.entries(sort)) {
        const aVal = aRecord[key];
        const bVal = bRecord[key];

        // Compare as strings or numbers
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          const cmp = aVal.localeCompare(bVal);
          if (cmp !== 0) return cmp * direction;
        } else if (typeof aVal === 'number' && typeof bVal === 'number') {
          if (aVal < bVal) return -1 * direction;
          if (aVal > bVal) return 1 * direction;
        } else {
          // Fallback to string comparison
          const aStr = String(aVal ?? '');
          const bStr = String(bVal ?? '');
          const cmp = aStr.localeCompare(bStr);
          if (cmp !== 0) return cmp * direction;
        }
      }

      return 0;
    });
  }

  private async save(): Promise<void> {
    const filePath = path.isAbsolute(this.config.filePath)
      ? this.config.filePath
      : path.join(this.workspaceRoot, this.config.filePath);

    const data: Record<string, unknown[]> = {};
    for (const [key, value] of this.data.entries()) {
      data[key] = value;
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }
}

/**
 * In-Memory Database Adapter (for testing/simple use cases)
 */
export class InMemoryDatabaseAdapter implements IDatabaseAdapter {
  private data: Map<string, unknown[]> = new Map();
  private connected = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.data.clear();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async execute(query: DatabaseQuery): Promise<DatabaseResult> {
    if (!this.connected) {
      return { success: false, error: 'Not connected' };
    }

    const collectionName = query.collection || query.table || 'default';
    let collection = this.data.get(collectionName);

    if (!collection) {
      collection = [];
      this.data.set(collectionName, collection);
    }

    switch (query.operation) {
      case 'find': {
        let results = this.filterItems(collection, query.filter);
        if (query.skip) results = results.slice(query.skip);
        if (query.limit) results = results.slice(0, query.limit);
        return { success: true, data: results };
      }

      case 'findOne': {
        const results = this.filterItems(collection, query.filter);
        return { success: true, data: results[0] || null };
      }

      case 'insert': {
        const items = Array.isArray(query.data) ? query.data : [query.data];
        const inserted: unknown[] = [];

        for (const item of items) {
          const newItem = { id: this.generateId(), ...item };
          collection.push(newItem);
          inserted.push(newItem);
        }

        return {
          success: true,
          data: inserted.length === 1 ? inserted[0] : inserted,
        };
      }

      case 'update': {
        const matches = this.filterItems(collection, query.filter);
        for (const item of matches) {
          if (typeof item === 'object' && item !== null) {
            Object.assign(item as object, query.data || {});
          }
        }
        return { success: true, affected: matches.length };
      }

      case 'delete': {
        const before = collection.length;
        const filtered = collection.filter((item) => !this.matchesFilter(item, query.filter));
        this.data.set(collectionName, filtered);
        return { success: true, affected: before - filtered.length };
      }

      default:
        return { success: false, error: `Unknown operation: ${query.operation}` };
    }
  }

  private filterItems(items: unknown[], filter?: Record<string, unknown>): unknown[] {
    if (!filter) return [...items];
    return items.filter((item) => this.matchesFilter(item, filter));
  }

  private matchesFilter(item: unknown, filter?: Record<string, unknown>): boolean {
    if (!filter || typeof item !== 'object' || item === null) return true;
    const record = item as Record<string, unknown>;
    for (const [key, value] of Object.entries(filter)) {
      if (record[key] !== value) return false;
    }
    return true;
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }
}

/**
 * Database Service - manages database connections
 */
export class DatabaseService {
  private adapters: Map<string, IDatabaseAdapter> = new Map();
  private connections: Map<string, DatabaseConnection> = new Map();
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Add a database connection
   */
  async addConnection(connection: DatabaseConnection): Promise<void> {
    const adapter = this.createAdapter(connection);
    await adapter.connect();

    this.adapters.set(connection.id, adapter);
    this.connections.set(connection.id, connection);
  }

  /**
   * Remove a database connection
   */
  async removeConnection(connectionId: string): Promise<void> {
    const adapter = this.adapters.get(connectionId);
    if (adapter) {
      await adapter.disconnect();
      this.adapters.delete(connectionId);
    }
    this.connections.delete(connectionId);
  }

  /**
   * Get a connection by ID
   */
  getConnection(connectionId: string): DatabaseConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Get all connections
   */
  getAllConnections(): DatabaseConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Execute a query on a connection
   */
  async executeQuery(connectionId: string, query: DatabaseQuery): Promise<DatabaseResult> {
    const adapter = this.adapters.get(connectionId);
    if (!adapter) {
      return { success: false, error: `Connection not found: ${connectionId}` };
    }

    return adapter.execute(query);
  }

  /**
   * Check if a connection is active
   */
  isConnected(connectionId: string): boolean {
    const adapter = this.adapters.get(connectionId);
    return adapter?.isConnected() ?? false;
  }

  /**
   * Create appropriate adapter based on connection type
   */
  private createAdapter(connection: DatabaseConnection): IDatabaseAdapter {
    switch (connection.type) {
      case 'json':
        return new JsonDatabaseAdapter(connection.config as JsonDbConfig, this.workspaceRoot);

      case 'sqlite':
      case 'mongodb':
      case 'mysql':
      case 'postgresql':
        // These require external packages - return in-memory adapter as fallback
        console.warn(`Database type "${connection.type}" requires additional packages. Using in-memory adapter.`);
        return new InMemoryDatabaseAdapter();

      default:
        return new InMemoryDatabaseAdapter();
    }
  }

  /**
   * Disconnect all connections
   */
  async disconnectAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.disconnect();
    }
    this.adapters.clear();
  }
}
