import { query, run, transaction } from '@/database';
import type { Result } from '@/types/common';
import { formatError } from '@/utils/error-formatter';
import { logger } from '@/utils/logger';
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
    logger.debug(`Attempting to find user ID for originalTransactionId: ${payload.originalTransactionId} or appAccountToken: ${payload.appAccountToken}`);
    if (payload.appAccountToken) {
        try {
            const userResult = await query<{ id: string }>('SELECT id FROM users WHERE appAccountToken = ? LIMIT 1', [payload.appAccountToken]);
            if (userResult.length > 0) {
                 logger.info(`Found user ${userResult[0].id} via appAccountToken`);
                 return userResult[0].id;
            }
             logger.warn(`appAccountToken ${payload.appAccountToken} provided but no matching user found.`);
        } catch (error) {
             logger.error(`Database error looking up user by appAccountToken: ${formatError(error)}`);
        }
    }
    try {
         const subResult = await query<{ userId: string }>('SELECT userId FROM subscriptions WHERE originalTransactionId = ? ORDER BY createdAt DESC LIMIT 1', [payload.originalTransactionId]);
         if (subResult.length > 0) {
              logger.info(`Found user ${subResult[0].userId} via originalTransactionId ${payload.originalTransactionId}`);
              return subResult[0].userId;
         }
    } catch (error) {
         logger.error(`Database error looking up user by originalTransactionId: ${formatError(error)}`);
    }
    logger.error(`Could not find user ID for originalTransactionId: ${payload.originalTransactionId} and appAccountToken: ${payload.appAccountToken}`);
    return null;
}

export const verifyAndSaveSubscription = async (
  userId: string,
  payload: VerifiedNotificationPayload
): Promise<Result<{ subscriptionId: string }>> => {
  logger.info(`Verifying and saving subscription info for user ${userId} from payload (OrigTxID: ${payload.originalTransactionId})`);

  return await transaction<Result<{ subscriptionId: string }>>(async () => {
    try {
      const nowDbTimestamp = Math.floor(Date.now() / 1000);
      const recordId = payload.originalTransactionId;

      const userCheck = await query<{ id: string }>('SELECT id FROM users WHERE id = ? LIMIT 1', [userId]);
      if (userCheck.length === 0) {
          logger.error(`User ${userId} provided for subscription verification not found in database.`);
          throw new Error(`User ${userId} not found. Cannot save subscription ${recordId}.`);
      }

      const isRenewalInfo = payload.autoRenewStatus !== undefined && payload.autoRenewProductId !== undefined;
      const transactionJson = !isRenewalInfo ? JSON.stringify(payload) : null;
      const renewalJson = isRenewalInfo ? JSON.stringify(payload) : null;
      const expiresSec = payload.expiresDate ? Math.floor(payload.expiresDate / 1000) : null;
      const internalStatus = determineSubscriptionStatus(
        payload.expiresDate, payload.autoRenewStatus, payload.isInBillingRetryPeriod,
        payload.gracePeriodExpiresDate, payload.revocationDate, payload.type
      );

      await run(`
          INSERT INTO subscriptions (
              id, userId, originalTransactionId, productId, expiresDate, purchaseDate,
              status, environment, lastTransactionId, lastTransactionInfo, lastRenewalInfo,
              createdAt, updatedAt, appAccountToken, subscriptionGroupIdentifier, offerType, offerIdentifier
          ) VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
          ON CONFLICT(id) DO UPDATE SET
              userId = excluded.userId,
              productId = excluded.productId,
              expiresDate = excluded.expiresDate,
              purchaseDate = CASE WHEN excluded.purchaseDate < purchaseDate THEN excluded.purchaseDate ELSE purchaseDate END,
              status = excluded.status,
              environment = excluded.environment,
              lastTransactionId = CASE WHEN excluded.updatedAt >= updatedAt THEN excluded.lastTransactionId ELSE lastTransactionId END,
              lastTransactionInfo = CASE WHEN excluded.updatedAt >= updatedAt AND excluded.lastTransactionInfo IS NOT NULL THEN excluded.lastTransactionInfo ELSE lastTransactionInfo END,
              lastRenewalInfo = CASE WHEN excluded.updatedAt >= updatedAt AND excluded.lastRenewalInfo IS NOT NULL THEN excluded.lastRenewalInfo ELSE lastRenewalInfo END,
              updatedAt = excluded.updatedAt,
              appAccountToken = COALESCE(excluded.appAccountToken, appAccountToken),
              subscriptionGroupIdentifier = COALESCE(excluded.subscriptionGroupIdentifier, subscriptionGroupIdentifier),
              offerType = COALESCE(excluded.offerType, offerType),
              offerIdentifier = COALESCE(excluded.offerIdentifier, offerIdentifier)
          WHERE
              TRUE
      `, [
          recordId, userId, payload.originalTransactionId, payload.productId,
          expiresSec,
          Math.floor(payload.purchaseDate / 1000),
          internalStatus,
          payload.environment, payload.transactionId,
          transactionJson,
          renewalJson,
          Math.floor(payload.purchaseDate / 1000),
          nowDbTimestamp,
          payload.appAccountToken || null,
          payload.subscriptionGroupIdentifier || null,
          payload.offerType ?? null,
          payload.offerIdentifier || null
      ]);

      logger.info(`Successfully verified and saved subscription record ${recordId} for user ${userId}, status: ${internalStatus}`);
      return { success: true, data: { subscriptionId: recordId } };

    } catch (error) {
      logger.error(`Database error verifying/saving subscription for user ${userId}, originalTransactionId ${payload.originalTransactionId}: ${formatError(error)}`);
      throw error;
    }
  }).catch((error): Result<{ subscriptionId: string }> => {
      logger.error(`Transaction failed for verifyAndSaveSubscription (User: ${userId}, OrigTxID: ${payload.originalTransactionId}): ${formatError(error)}`);
      return { success: false, error: error instanceof Error ? error : new Error('Failed to verify/save subscription in database transaction') };
  });
};

export const updateSubscriptionFromNotification = async (payload: VerifiedNotificationPayload): Promise<Result<void>> => {
    const userId = await findUserIdForNotification(payload);

    if (!userId) {
        logger.error(`Failed to find user for notification. Original Transaction ID: ${payload.originalTransactionId}, App Account Token: ${payload.appAccountToken}`);
        return { success: false, error: new Error('User mapping not found for transaction notification') };
    }

    logger.info(`Processing notification update for user ${userId}, original transaction ID: ${payload.originalTransactionId}`);

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
        logger.warn(`Could not determine internal status via helper for transaction ${payload.transactionId}`);
    }

    return await transaction<Result<void>>(async () => {
        try {
            const nowDbTimestamp = Math.floor(Date.now() / 1000);
            const recordId = payload.originalTransactionId;

            const userCheck = await query<{ id: string }>('SELECT id FROM users WHERE id = ? LIMIT 1', [userId]);
            if (userCheck.length === 0) {
                logger.error(`User ${userId} (found via notification mapping) not found in DB. Cannot reliably update subscription ${recordId}.`);
                throw new Error(`User ${userId} mapping exists, but user record not found for subscription ${recordId}`);
            }

            await run(`
                INSERT INTO subscriptions (
                    id, userId, originalTransactionId, productId, expiresDate, purchaseDate,
                    status, environment, lastTransactionId, lastTransactionInfo, lastRenewalInfo,
                    createdAt, updatedAt, appAccountToken, subscriptionGroupIdentifier, offerType, offerIdentifier
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                )
                ON CONFLICT(id) DO UPDATE SET
                    userId = excluded.userId,
                    productId = excluded.productId,
                    expiresDate = excluded.expiresDate,
                    purchaseDate = CASE WHEN excluded.purchaseDate < purchaseDate THEN excluded.purchaseDate ELSE purchaseDate END,
                    status = excluded.status,
                    environment = excluded.environment,
                    lastTransactionId = CASE WHEN excluded.updatedAt >= updatedAt THEN excluded.lastTransactionId ELSE lastTransactionId END,
                    lastTransactionInfo = CASE WHEN excluded.updatedAt >= updatedAt AND excluded.lastTransactionInfo IS NOT NULL THEN excluded.lastTransactionInfo ELSE lastTransactionInfo END,
                    lastRenewalInfo = CASE WHEN excluded.updatedAt >= updatedAt AND excluded.lastRenewalInfo IS NOT NULL THEN excluded.lastRenewalInfo ELSE lastRenewalInfo END,
                    updatedAt = excluded.updatedAt,
                    appAccountToken = COALESCE(excluded.appAccountToken, appAccountToken),
                    subscriptionGroupIdentifier = COALESCE(excluded.subscriptionGroupIdentifier, subscriptionGroupIdentifier),
                    offerType = COALESCE(excluded.offerType, offerType),
                    offerIdentifier = COALESCE(excluded.offerIdentifier, offerIdentifier)
                WHERE
                    TRUE
            `, [
                recordId, userId, payload.originalTransactionId, payload.productId,
                expiresSec,
                Math.floor(payload.purchaseDate / 1000),
                internalStatus,
                payload.environment, payload.transactionId,
                transactionJson,
                renewalJson,
                Math.floor(payload.purchaseDate / 1000),
                nowDbTimestamp,
                payload.appAccountToken || null,
                payload.subscriptionGroupIdentifier || null,
                payload.offerType ?? null,
                payload.offerIdentifier || null
            ]);

            logger.info(`Successfully updated subscription record via notification for user ${userId}, original transaction ID: ${payload.originalTransactionId}, status: ${internalStatus}`);
            return { success: true, data: undefined };

        } catch (error) {
            logger.error(`Database error updating subscription from notification for user ${userId}, originalTransactionId ${payload.originalTransactionId}: ${formatError(error)}`);
            throw error;
        }
    }).catch((error): Result<void> => {
         logger.error(`Transaction failed for updateSubscriptionFromNotification (User: ${userId}, OrigTxID: ${payload.originalTransactionId}): ${formatError(error)}`);
         return { success: false, error: error instanceof Error ? error : new Error('Failed to update subscription in database transaction') };
    });
};

export const hasActiveSubscription = async (userId: string): Promise<ActiveSubscriptionStatus> => {
    logger.debug(`Checking active subscription status for user ${userId}`);
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
            logger.info(`User ${userId} has an active subscription: ${sub.productId}, Expires: ${expiresMs ? new Date(expiresMs).toISOString() : 'Never'}, Status: ${sub.status}`);
            return {
                isActive: true,
                expiresDate: expiresMs,
                type: sub.productId,
                subscriptionId: sub.id
            };
        } else {
             logger.info(`User ${userId} does not have an active subscription.`);
             return { isActive: false };
        }
    } catch (error) {
         logger.error(`Database error checking subscription status for user ${userId}: ${formatError(error)}`);
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
    logger.warn(`Cannot determine status: expiresDate is missing and type is not Non-Consumable/Non-Renewing.`);
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