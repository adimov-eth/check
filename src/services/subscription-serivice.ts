import { query, run, transaction } from '@/database';
import type { Result } from '@/types/common';
import { formatError } from '@/utils/error-formatter';
import { log } from '@/utils/logger';
import type { VerifiedNotificationPayload } from './apple-jws-verifier';

// Interface matching the database 'subscriptions' table structure
interface SubscriptionRecord {
  id: string;
  userId: string;
  originalTransactionId: string;
  productId: string;
  expiresDate: number | null;
  purchaseDate: number;
  status: string;
  environment: 'Sandbox' | 'Production';
  lastTransactionId: string;
  lastTransactionInfo: string | null;
  lastRenewalInfo: string | null;
  createdAt: number;
  updatedAt: number;
  appAccountToken?: string | null;
  subscriptionGroupIdentifier?: string | null;
  offerType?: number | null;
  offerIdentifier?: string | null;
}

// Return type for hasActiveSubscription
interface ActiveSubscriptionStatus {
    isActive: boolean;
    expiresDate?: number | null;
    type?: string | null;
    subscriptionId?: string | null;
}

async function findUserIdForNotification(payload: VerifiedNotificationPayload): Promise<string | null> {
    log.debug(`Attempting to find user ID`, { originalTransactionId: payload.originalTransactionId, appAccountToken: payload.appAccountToken });
    if (payload.appAccountToken) {
        try {
            const userResult = await query<{ id: string }>('SELECT id FROM users WHERE appAccountToken = ? LIMIT 1', [payload.appAccountToken]);
            if (userResult.length > 0) {
                 log.info(`Found user via appAccountToken`, { userId: userResult[0].id, appAccountToken: payload.appAccountToken });
                 return userResult[0].id;
            }
             log.warn(`appAccountToken provided but no matching user found`, { appAccountToken: payload.appAccountToken });
        } catch (error) {
             log.error(`Database error looking up user by appAccountToken`, { appAccountToken: payload.appAccountToken, error: formatError(error) });
        }
    }
    try {
         const subResult = await query<{ userId: string }>('SELECT userId FROM subscriptions WHERE originalTransactionId = ? ORDER BY createdAt DESC LIMIT 1', [payload.originalTransactionId]);
         if (subResult.length > 0) {
              log.info(`Found user via originalTransactionId`, { userId: subResult[0].userId, originalTransactionId: payload.originalTransactionId });
              return subResult[0].userId;
         }
    } catch (error) {
         log.error(`Database error looking up user by originalTransactionId`, { originalTransactionId: payload.originalTransactionId, error: formatError(error) });
    }
    log.error(`Could not find user ID`, { originalTransactionId: payload.originalTransactionId, appAccountToken: payload.appAccountToken });
    return null;
}

// Helper function to perform the database UPSERT operation
// This is kept internal to this module
const _upsertSubscriptionRecord = async (
  userId: string,
  payload: VerifiedNotificationPayload,
  internalStatus: string,
  expiresSec: number | null,
  transactionJson: string | null,
  renewalJson: string | null
): Promise<void> => {
  const nowDbTimestamp = Math.floor(Date.now() / 1000);
  const recordId = payload.originalTransactionId;

  await run(`
      INSERT INTO subscriptions (
          id, userId, originalTransactionId, productId, expiresDate, purchaseDate,
          status, environment, lastTransactionId, lastTransactionInfo, lastRenewalInfo,
          createdAt, updatedAt, appAccountToken, subscriptionGroupIdentifier, offerType, offerIdentifier
      ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
          userId = excluded.userId, // Ensure userId is updated if needed
          productId = excluded.productId,
          expiresDate = excluded.expiresDate,
          // Keep the earliest purchase date on conflict
          purchaseDate = CASE WHEN excluded.purchaseDate < purchaseDate THEN excluded.purchaseDate ELSE purchaseDate END,
          status = excluded.status,
          environment = excluded.environment,
          // Update transaction/renewal info only if the current payload is newer or equally new
          lastTransactionId = CASE WHEN excluded.updatedAt >= updatedAt THEN excluded.lastTransactionId ELSE lastTransactionId END,
          lastTransactionInfo = CASE WHEN excluded.updatedAt >= updatedAt AND excluded.lastTransactionInfo IS NOT NULL THEN excluded.lastTransactionInfo ELSE lastTransactionInfo END,
          lastRenewalInfo = CASE WHEN excluded.updatedAt >= updatedAt AND excluded.lastRenewalInfo IS NOT NULL THEN excluded.lastRenewalInfo ELSE lastRenewalInfo END,
          updatedAt = excluded.updatedAt,
          // Preserve existing token/identifiers if the new payload doesn't have them
          appAccountToken = COALESCE(excluded.appAccountToken, appAccountToken),
          subscriptionGroupIdentifier = COALESCE(excluded.subscriptionGroupIdentifier, subscriptionGroupIdentifier),
          offerType = COALESCE(excluded.offerType, offerType),
          offerIdentifier = COALESCE(excluded.offerIdentifier, offerIdentifier)
      WHERE
          TRUE // Always perform the update on conflict
  `, [
      recordId, userId, payload.originalTransactionId, payload.productId,
      expiresSec,
      Math.floor(payload.purchaseDate / 1000),
      internalStatus,
      payload.environment, payload.transactionId,
      transactionJson, // Use passed-in JSON
      renewalJson,    // Use passed-in JSON
      Math.floor(payload.purchaseDate / 1000), // createdAt (only on insert)
      nowDbTimestamp, // updatedAt
      payload.appAccountToken || null,
      payload.subscriptionGroupIdentifier || null,
      payload.offerType ?? null,
      payload.offerIdentifier || null
  ]);
};

export const verifyAndSaveSubscription = async (
  userId: string,
  payload: VerifiedNotificationPayload
): Promise<Result<{ subscriptionId: string }>> => {
  log.info(`Verifying and saving subscription info`, { userId, originalTransactionId: payload.originalTransactionId });

  // Use transaction for atomicity
  return await transaction<Result<{ subscriptionId: string }>>(async () => {
    try {
      const recordId = payload.originalTransactionId;

      // 1. Verify user exists before proceeding
      const userCheck = await query<{ id: string }>('SELECT id FROM users WHERE id = ? LIMIT 1', [userId]);
      if (userCheck.length === 0) {
          log.error(`User provided for subscription verification not found in database`, { userId, originalTransactionId: payload.originalTransactionId });
          throw new Error(`User ${userId} not found. Cannot save subscription ${recordId}.`);
      }

      // 2. Prepare data for upsert
      const isRenewalInfo = payload.autoRenewStatus !== undefined && payload.autoRenewProductId !== undefined;
      const transactionJson = !isRenewalInfo ? JSON.stringify(payload) : null;
      const renewalJson = isRenewalInfo ? JSON.stringify(payload) : null;
      const expiresSec = payload.expiresDate ? Math.floor(payload.expiresDate / 1000) : null;
      const internalStatus = determineSubscriptionStatus(
        payload.expiresDate, payload.autoRenewStatus, payload.isInBillingRetryPeriod,
        payload.gracePeriodExpiresDate, payload.revocationDate, payload.type
      );

      // 3. Call the internal upsert function
      await _upsertSubscriptionRecord(
        userId,
        payload,
        internalStatus,
        expiresSec,
        transactionJson,
        renewalJson
      );

      log.info(`Successfully verified and saved subscription record`, { recordId, userId, status: internalStatus });
      return { success: true, data: { subscriptionId: recordId } };

    } catch (error) {
      // Log specific error from this function context
      log.error(`Database error during verifyAndSaveSubscription`, { userId, originalTransactionId: payload.originalTransactionId, error: formatError(error) });
      // Re-throw to trigger transaction rollback
      throw error;
    }
  }).catch((error): Result<{ subscriptionId: string }> => {
      // Catch errors specifically from the transaction execution (including re-thrown ones)
      log.error(`Transaction failed for verifyAndSaveSubscription`, { userId, originalTransactionId: payload.originalTransactionId, error: formatError(error) });
      // Return a failure Result
      return { success: false, error: error instanceof Error ? error : new Error('Failed to verify/save subscription in database transaction') };
  });
};

export const updateSubscriptionFromNotification = async (payload: VerifiedNotificationPayload): Promise<Result<void>> => {
    // 1. Find the associated user ID first
    const userId = await findUserIdForNotification(payload);

    if (!userId) {
        log.error(`Failed to find user for notification`, { originalTransactionId: payload.originalTransactionId, appAccountToken: payload.appAccountToken });
        return { success: false, error: new Error('User mapping not found for transaction notification') };
    }

    log.info(`Processing notification update`, { userId, originalTransactionId: payload.originalTransactionId });

    // Use transaction for atomicity
    return await transaction<Result<void>>(async () => {
        try {
          // 2. Verify user exists (redundant check, but safe)
          const userCheck = await query<{ id: string }>('SELECT id FROM users WHERE id = ? LIMIT 1', [userId]);
          if (userCheck.length === 0) {
              log.error(`User (found via notification mapping) not found in DB`, { userId, recordId: payload.originalTransactionId });
              throw new Error(`User ${userId} mapping exists, but user record not found for subscription ${payload.originalTransactionId}`);
          }

          // 3. Prepare data for upsert
          const isRenewalInfo = payload.autoRenewStatus !== undefined && payload.autoRenewProductId !== undefined;
          const transactionJson = !isRenewalInfo ? JSON.stringify(payload) : null;
          const renewalJson = isRenewalInfo ? JSON.stringify(payload) : null;
          const expiresSec = payload.expiresDate ? Math.floor(payload.expiresDate / 1000) : null;
          const internalStatus = determineSubscriptionStatus(
              payload.expiresDate,
              payload.autoRenewStatus,
              payload.isInBillingRetryPeriod,
              payload.gracePeriodExpiresDate,
              payload.revocationDate,
              payload.type
          );
          if (internalStatus === 'unknown') {
              log.warn(`Could not determine internal status via helper`, { transactionId: payload.transactionId });
          }

          // 4. Call the internal upsert function
          await _upsertSubscriptionRecord(
            userId,
            payload,
            internalStatus,
            expiresSec,
            transactionJson,
            renewalJson
          );

          log.info(`Successfully updated subscription record via notification`, { userId, originalTransactionId: payload.originalTransactionId, status: internalStatus });
          return { success: true, data: undefined }; // Return success Result

        } catch (error) {
             // Log specific error from this function context
            log.error(`Database error during updateSubscriptionFromNotification`, { userId, originalTransactionId: payload.originalTransactionId, error: formatError(error) });
             // Re-throw to trigger transaction rollback
            throw error;
        }
    }).catch((error): Result<void> => {
         // Catch errors specifically from the transaction execution (including re-thrown ones)
         log.error(`Transaction failed for updateSubscriptionFromNotification`, { userId, originalTransactionId: payload.originalTransactionId, error: formatError(error) });
         // Return a failure Result
         return { success: false, error: error instanceof Error ? error : new Error('Failed to update subscription in database transaction') };
    });
};

export const hasActiveSubscription = async (userId: string): Promise<ActiveSubscriptionStatus> => {
    log.debug(`Checking active subscription status`, { userId });
    try {
        const nowSec = Math.floor(Date.now() / 1000);
        const results = await query<SubscriptionRecord>(
             `SELECT id, expiresDate, productId, status FROM subscriptions
              WHERE userId = ? AND status IN ('active', 'grace_period') AND (expiresDate IS NULL OR expiresDate > ?)
              ORDER BY expiresDate DESC NULLS LAST LIMIT 1`,
             [userId, nowSec]
         );

        if (results.length > 0) {
            const sub = results[0];
            const expiresMs = sub.expiresDate ? sub.expiresDate * 1000 : null;
            log.info(`User has an active subscription`, { userId, productId: sub.productId, expires: expiresMs ? new Date(expiresMs).toISOString() : 'Never', status: sub.status });
            return {
                isActive: true,
                expiresDate: expiresMs,
                type: sub.productId,
                subscriptionId: sub.id
            };
        } else {
             log.info(`User does not have an active subscription`, { userId });
             return { isActive: false };
        }
    } catch (error) {
         log.error(`Database error checking subscription status`, { userId, error: formatError(error) });
         return { isActive: false };
    }
};

const determineSubscriptionStatus = (
  expiresDateMs: number | null | undefined,
  autoRenewStatus?: number,
  isInBillingRetryPeriod?: boolean,
  gracePeriodExpiresDateMs?: number | null | undefined,
  revocationDateMs?: number | null | undefined,
  subscriptionType?: string
): string => {
  const now = Date.now();
  
  if (revocationDateMs && revocationDateMs <= now) {
    return 'revoked';
  }
  
  if (isInBillingRetryPeriod) {
    return 'billing_retry';
  }
  
  if (gracePeriodExpiresDateMs && gracePeriodExpiresDateMs > now) {
    return 'grace_period';
  }
  
  if (!expiresDateMs && subscriptionType && (subscriptionType === 'Non-Consumable' || subscriptionType === 'Non-Renewing Subscription')) {
    return 'active';
  }
  
  if (!expiresDateMs) {
    log.warn(`Cannot determine status: expiresDate is missing and type is not Non-Consumable/Non-Renewing.`);
    return 'unknown';
  }
  
  if (expiresDateMs > now) {
    return 'active';
  }
  
  if (autoRenewStatus === 0) {
    return 'cancelled';
  }
  
  return 'expired';
};