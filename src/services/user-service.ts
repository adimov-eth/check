// server/src/services/user-service.ts

import type { Result } from '@/types/common';
import { verifyAppleToken } from '@/utils/apple-auth';
import { formatError } from '@/utils/error-formatter';
import { logger } from '@/utils/logger';
import { query, queryOne, run, transaction } from '../database';
import type { User } from '../types';

/**
 * Get a user by ID
 * @param id User ID to fetch
 * @returns User object or null if not found
 */
export const getUser = async (id: string): Promise<User | null> => {
  try {
    const users = await query<User>('SELECT * FROM users WHERE id = ?', [id]);
    return users[0] ?? null;
  } catch (error) {
    logger.error(`Error fetching user: ${formatError(error)}`);
    throw error;
  }
};

/**
 * Create or update a user
 * @param params User data to create or update
 * @returns Result object indicating success or failure
 */
export const upsertUser = async ({
  id,
  email,
  name
}: {
  id: string,
  email: string,
  name?: string
}): Promise<Result<void>> => {
  return await transaction(async () => {
    try {
      // Check if email is already used by another user
      const existingUsers = await query<User>(
        'SELECT * FROM users WHERE email = ? AND id != ? LIMIT 1',
        [email, id]
      );

      if (existingUsers[0]) {
        logger.warn(`Email ${email} is already in use by another user`);
        return {
          success: false,
          error: new Error(`Email ${email} is already in use by another user`)
        };
      }

      await run(`
        INSERT INTO users (id, email, name)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          email = excluded.email,
          name = excluded.name,
          updatedAt = strftime('%s', 'now')
      `, [id, email, name ?? null]);

      logger.info(`User ${id} upserted successfully`);
      return { success: true, data: undefined };
    } catch (error) {
      logger.error(`Error upserting user: ${formatError(error)}`);
      return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  });
};

/**
 * Delete a user by ID
 * @param id User ID to delete
 * @returns Result object indicating success or failure
 */
export const deleteUser = async (id: string): Promise<Result<void>> => {
  return await transaction(async () => {
    try {
      // First verify user exists
      const userExistsResult = await query<{ exists: number }>(
        'SELECT 1 as exists FROM users WHERE id = ? LIMIT 1',
        [id]
      );

      const userExists = userExistsResult[0]?.exists === 1;

      if (!userExists) {
        // User doesn't exist - no need to delete, just log and return
        logger.info(`Delete requested for user ${id} but user not found in database - skipping delete`);
        return { success: true, data: undefined };
      }

      // Delete user and all related data will be cascaded due to foreign key constraints
      await run('DELETE FROM users WHERE id = ?', [id]);
      logger.info(`User ${id} deleted successfully`);
      return { success: true, data: undefined };
    } catch (error) {
      logger.error(`Error deleting user: ${formatError(error)}`);
      return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  });
};

/**
 * Send a welcome email to a new user (Placeholder)
 * @param userId User ID to send welcome email to
 * @param email Email address to send to
 * @returns Result object indicating success or failure
 */
export const sendWelcomeEmail = async (userId: string, email: string): Promise<Result<void>> => {
  // --- Placeholder Implementation ---
  // In a real application, this would integrate with an email service
  // (e.g., SendGrid, Mailgun, AWS SES) to send a formatted welcome email.
  try {
    logger.info(`[Placeholder] Welcome email would be sent to user ${userId} at ${email}`);
    // Example: await emailService.send({ to: email, template: 'welcome', context: { userId } });
    return { success: true, data: undefined };
  } catch (error) {
    logger.error(`[Placeholder] Error queueing welcome email for ${userId}: ${formatError(error)}`);
    // If using a real service, return the actual error
    return { success: false, error: new Error('Failed to queue welcome email (Placeholder)') };
  }
  // --- End Placeholder ---
};

/**
 * Authenticate with Apple ID token
 * @param identityToken The ID token from Apple Sign In
 * @param name Optional user name provided by Apple (only on first sign-in)
 * @returns Result object with user data if authentication is successful
 */
/**
 * Authenticate with Apple ID token
 * @param identityToken The ID token from Apple Sign In
 * @param name Optional user name provided by Apple (only on first sign-in)
 * @returns Result object with user data if authentication is successful
 */
export const authenticateWithApple = async (
  identityToken: string,
  name?: string
): Promise<Result<User>> => {
  try {
    // Verify Apple token
    const verificationResult = await verifyAppleToken(identityToken);
    if (!verificationResult.success) {
      logger.error(`Apple token verification failed: ${verificationResult.error.message}`);
      return { success: false, error: verificationResult.error };
    }

    const { userId, email } = verificationResult.data;
    const appleId = `apple:${userId}`; // The Apple user ID we're using

    if (!email) {
      logger.error(`Apple authentication failed: No email provided in token`);
      return {
        success: false,
        error: new Error('Authentication requires an email address')
      };
    }

    // Check if the email is already in use by another user.
    const existingUserWithEmail = await queryOne<User>(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (existingUserWithEmail && existingUserWithEmail.id !== appleId) {
      // Email is already associated with a different user.
      // Don't link the accounts automatically.  Return an error that the
      // client can handle.
      logger.warn(`Email ${email} already exists. Apple ID ${appleId} cannot be linked to user ${existingUserWithEmail.id}`);
      return {
        success: false,
        error: new Error(`Email ${email} is already associated with another account. Please sign in with that account and link Apple Sign-In in profile settings.`),
        code: 'EMAIL_ALREADY_EXISTS'
      };

    } else {
      // No conflicting email, proceed with upsert as before
      const upsertResult = await upsertUser({
        id: appleId,
        email,
        name
      });

      if (!upsertResult.success) {
        return { success: false, error: upsertResult.error };
      }

      const user = await getUser(appleId);
      if (!user) {
        return {
          success: false,
          error: new Error('Failed to create or retrieve user account')
        };
      }

      logger.info(`User authenticated with Apple: ${user.id}`);
      return { success: true, data: user };
    }
  } catch (error) {
    logger.error(`Error in Apple authentication: ${formatError(error)}`);
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
};