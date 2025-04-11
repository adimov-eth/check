import type { Result } from '@/types/common';
import { verifyAppleToken } from '@/utils/apple-auth';
import { formatError } from '@/utils/error-formatter';
import { log } from '@/utils/logger';
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
    log.error(`Error fetching user`, { userId: id, error: formatError(error) });
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
        log.warn(`Email already in use by another user`, { email, existingUserId: existingUsers[0].id, requestedUserId: id });
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

      log.info(`User upserted successfully`, { userId: id });
      return { success: true, data: undefined };
    } catch (error) {
      log.error(`Error upserting user`, { userId: id, email, error: formatError(error) });
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
        log.info(`Delete requested for user but user not found in database - skipping delete`, { userId: id });
        return { success: true, data: undefined };
      }

      // Delete user and all related data will be cascaded due to foreign key constraints
      await run('DELETE FROM users WHERE id = ?', [id]);
      log.info(`User deleted successfully`, { userId: id });
      return { success: true, data: undefined };
    } catch (error) {
      log.error(`Error deleting user`, { userId: id, error: formatError(error) });
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
    log.info(`[Placeholder] Welcome email would be sent`, { userId, email });
    // Example: await emailService.send({ to: email, template: 'welcome', context: { userId } });
    return { success: true, data: undefined };
  } catch (error) {
    log.error(`[Placeholder] Error queueing welcome email`, { userId, email, error: formatError(error) });
    // If using a real service, return the actual error
    return { success: false, error: new Error('Failed to queue welcome email (Placeholder)') };
  }
  // --- End Placeholder ---
};

// Helper function to find or create/update user during Apple Auth
// Returns the user record or throws if creation fails
const _findOrCreateAppleUser = async (
  appleId: string,
  email: string,
  name?: string
): Promise<User> => {
  const upsertResult = await upsertUser({
    id: appleId,
    email,
    name
  });

  if (!upsertResult.success) {
    // If upsert failed, re-throw the specific error
    throw upsertResult.error;
  }

  // After successful upsert, retrieve the definitive user record
  const user = await getUser(appleId);
  if (!user) {
    // This should theoretically not happen after a successful upsert, but handle defensively
    log.error('Failed to retrieve user immediately after upsert', { appleId });
    throw new Error('Failed to create or retrieve user account after upsert');
  }

  return user;
};

/**
 * Authenticate with Apple ID token
 * @param identityToken The ID token from Apple Sign In
 * @param requestEmail Email provided from the client request body (fallback)
 * @param name Optional user name provided by Apple (only on first sign-in) or from request
 * @returns Result object with user data if authentication is successful
 */
export const authenticateWithApple = async (
  identityToken: string,
  requestEmail?: string | null, // Added parameter
  name?: string
): Promise<Result<User, Error>> => { // Specify Error type for clarity
  try {
    // 1. Verify Apple token
    const verificationResult = await verifyAppleToken(identityToken);
    if (!verificationResult.success) {
      log.error(`Apple token verification failed`, { error: verificationResult.error.message });
      return { success: false, error: verificationResult.error };
    }

    const { userId: appleSub, email: tokenEmail } = verificationResult.data;
    const appleId = `apple:${appleSub}`; // Consistent internal ID format

    // ---> 2. Determine Email to Use <---
    // Prioritize email from the verified token if available, otherwise use the one from the request body.
    const emailToUse = tokenEmail || requestEmail;

    if (!emailToUse) {
      log.error(`Apple authentication failed: No email provided in token or request`, { appleSub });
      return {
        success: false,
        error: new Error('Authentication requires an email address')
      };
    }
    // ---> Email Determined <---

    // 3. Check for email conflict with a *different* user ID
    const existingUserWithEmail = await queryOne<User>(
      'SELECT * FROM users WHERE email = ? AND id != ?',
      [emailToUse, appleId] // Check for email conflict with other users
    );

    if (existingUserWithEmail) {
      // Email is already associated with a different user account.
      log.warn(`Email already exists. Apple ID cannot be linked`, { email: emailToUse, appleId, existingUserId: existingUserWithEmail.id });
      return {
        success: false,
        error: new Error(`Email ${emailToUse} is already associated with another account. Please sign in with that account or use a different email.`),
        code: 'EMAIL_ALREADY_EXISTS' // Specific code for client handling
      };
    }

    // 4. Find (or create) the user associated with this Apple ID
    // The helper function handles upsert and retrieval
    const user = await _findOrCreateAppleUser(appleId, emailToUse, name);

    log.info(`User authenticated with Apple`, { userId: user.id });
    return { success: true, data: user };

  } catch (error) {
    // Catch errors from token verification or user creation/retrieval
    log.error(`Error in Apple authentication process`, { error: formatError(error) });
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
};