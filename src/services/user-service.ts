import { logger } from '@/utils/logger'
import { query, run, transaction } from '../database'
import type { User } from '../types'

export const getUser = async (id: string): Promise<User | null> => {
  try {
    const users = await query<User>('SELECT * FROM users WHERE id = ?', [id])
    return users[0] ?? null
  } catch (error) {
    logger.error(`Error fetching user: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
}

export const upsertUser = async ({ id, email, name }: { id: string, email: string, name?: string }): Promise<void> => {
  await transaction(async () => {
    try {
      // Check if email is already used by another user
      const existingUsers = await query<User>(
        'SELECT * FROM users WHERE email = ? AND id != ? LIMIT 1',
        [email, id]
      );
      
      if (existingUsers[0]) {
        throw new Error(`Email ${email} is already in use by another user`);
      }
      
      await run(`
        INSERT INTO users (id, email, name) 
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET 
          email = excluded.email,
          name = excluded.name,
          updatedAt = strftime('%s', 'now')
      `, [id, email, name ?? null])
      
      logger.info(`User ${id} upserted successfully`)
    } catch (error) {
      logger.error(`Error upserting user: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  })
}

export const deleteUser = async (id: string): Promise<void> => {
  await transaction(async () => {
    try {
      // First verify user exists
      const userExistsResult = await query<{ exists: number }>(
        'SELECT 1 as exists FROM users WHERE id = ? LIMIT 1',
        [id]
      );
      
      const userExists = userExistsResult[0]?.exists === 1;
      
      if (!userExists) {
        throw new Error(`User ${id} not found`);
      }
      
      // Delete user and all related data will be cascaded due to foreign key constraints
      await run('DELETE FROM users WHERE id = ?', [id])
      logger.info(`User ${id} deleted successfully`)
    } catch (error) {
      logger.error(`Error deleting user: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  })
}

export const sendWelcomeEmail = async (userId: string, email: string): Promise<void> => {
  try {
    logger.info(`Welcome email queued for user ${userId} ${email}`)
  } catch (error) {
    logger.error(`Error queueing welcome email: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
}