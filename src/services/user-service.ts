import { query, run } from '../database'
import { User } from '../types'

export const getUser = async (id: string): Promise<User | null> => {
  const users = query<User>('SELECT * FROM users WHERE id = ?', [id])
  return users[0] ?? null
}

export const upsertUser = async ({ id, email, name }: { id: string, email: string, name?: string }): Promise<void> => {
  run(`
    INSERT INTO users (id, email, name) 
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET 
      email = excluded.email,
      name = excluded.name,
      updatedAt = strftime('%s', 'now')
  `, [id, email, name])
}

export const deleteUser = async (id: string): Promise<void> => {
  run('DELETE FROM users WHERE id = ?', [id])
}

import { emailQueue } from '../queues'

export const sendWelcomeEmail = async (userId: string, email: string): Promise<void> => {
  await emailQueue.add('send-welcome', { userId, email })
}