import type { SQLQueryBindings } from 'bun:sqlite'
import { Database } from 'bun:sqlite'

export const initDb = (): Database => {
  const db = new Database('app.db', { create: true })
  db.exec('PRAGMA journal_mode = WAL;') // Write-Ahead Logging for performance
  db.exec('PRAGMA synchronous = NORMAL;') // Balanced safety/performance
  return db
}

export const query = <T>(sql: string, params: SQLQueryBindings[] = []): T[] => {
    const stmt = db.prepare(sql)
    return stmt.all(...params) as T[]
  }
  
  export const run = (sql: string, params: SQLQueryBindings[] = []): void => {
    const stmt = db.prepare(sql)
    stmt.run(...params)
  }

export const db = initDb()