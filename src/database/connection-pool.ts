import { logger } from '@/utils';
import { Database, type SQLQueryBindings } from 'bun:sqlite';

interface PoolConnection {
  id: number;
  db: Database;
  inUse: boolean;
  lastUsed: number;
}

interface PoolOptions {
  maxConnections: number;
  idleTimeout: number;
  acquireTimeout: number;
}

const DEFAULT_OPTIONS: PoolOptions = {
  maxConnections: 50,
  idleTimeout: 60000, // 1 minute
  acquireTimeout: 5000, // 5 seconds
};

export class ConnectionPool {
  private connections: PoolConnection[] = [];
  private options: PoolOptions;

  constructor(options: Partial<PoolOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  private createConnection(): PoolConnection {
    const db = new Database('app.db', { create: true });
    
    // Apply optimizations
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA cache_size = -64000;');
    db.exec('PRAGMA temp_store = MEMORY;');
    db.exec('PRAGMA busy_timeout = 5000;');

    const connection: PoolConnection = {
      id: this.connections.length + 1,
      db,
      inUse: false,
      lastUsed: Date.now(),
    };

    this.connections.push(connection);
    logger.info(`Created new database connection #${connection.id}`);
    return connection;
  }

  private async acquireConnection(): Promise<PoolConnection> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.options.acquireTimeout) {
      // Try to find an available connection
      const connection = this.connections.find(conn => !conn.inUse);
      
      if (connection) {
        connection.inUse = true;
        connection.lastUsed = Date.now();
        return connection;
      }

      // Create new connection if pool isn't full
      if (this.connections.length < this.options.maxConnections) {
        const newConnection = this.createConnection();
        newConnection.inUse = true;
        return newConnection;
      }

      // Wait before trying again
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error('Failed to acquire database connection: pool exhausted');
  }

  private releaseConnection(connection: PoolConnection): void {
    connection.inUse = false;
    connection.lastUsed = Date.now();
  }

  public async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const connection = await this.acquireConnection();
    
    try {
      const stmt = connection.db.prepare(sql);
      return stmt.all(...params as SQLQueryBindings[]) as T[];
    } finally {
      this.releaseConnection(connection);
    }
  }

  public async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const results = await this.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  public async run(sql: string, params: unknown[] = []): Promise<void> {
    const connection = await this.acquireConnection();
    
    try {
      const stmt = connection.db.prepare(sql);
      stmt.run(...params as SQLQueryBindings[]);
    } finally {
      this.releaseConnection(connection);
    }
  }

  public async transaction<T>(callback: (db: Database) => Promise<T>): Promise<T> {
    const connection = await this.acquireConnection();
    
    try {
      connection.db.exec('BEGIN TRANSACTION');
      const result = await callback(connection.db);
      connection.db.exec('COMMIT');
      return result;
    } catch (error) {
      connection.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.releaseConnection(connection);
    }
  }

  public cleanup(): void {
    const now = Date.now();
    
    // Close idle connections that exceed timeout
    this.connections = this.connections.filter(connection => {
      if (!connection.inUse && now - connection.lastUsed > this.options.idleTimeout) {
        connection.db.close();
        logger.info(`Closed idle database connection #${connection.id}`);
        return false;
      }
      return true;
    });
  }

  public close(): void {
    // Close all connections
    this.connections.forEach(connection => {
      try {
        connection.db.close();
        logger.info(`Closed database connection #${connection.id}`);
      } catch (error) {
        logger.error(`Error closing connection #${connection.id}: ${error}`);
      }
    });
    this.connections = [];
  }
} 