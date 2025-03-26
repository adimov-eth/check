import { config } from '@/config';
import { query, run, transaction } from '@/database';
import type { Subscription } from '@/types';
import { logger } from '@/utils/logger';
import fetch from 'node-fetch';

// Product ID mapping to subscription types
const PRODUCT_ID_MAP: Record<string, string> = {
  'com.vibecheck.subscription.monthly': 'monthly',
  'com.vibecheck.subscription.yearly': 'yearly',
};

// Apple verification endpoints
const APPLE_VERIFICATION_ENDPOINTS = {
  production: 'https://buy.itunes.apple.com/verifyReceipt',
  sandbox: 'https://sandbox.itunes.apple.com/verifyReceipt',
} as const;

interface AppleVerificationResponse {
  status: number;
  environment: string;
  receipt: {
    in_app: Array<{
      product_id: string;
      transaction_id: string;
      original_transaction_id: string;
      purchase_date_ms: string;
      expires_date_ms?: string;
    }>;
  };
  latest_receipt_info?: Array<{
    product_id: string;
    transaction_id: string;
    original_transaction_id: string;
    purchase_date_ms: string;
    expires_date_ms?: string;
  }>;
}

interface VerificationResult {
  isValid: boolean;
  expiresDate: number | null;
  environment: string;
  productId: string | null;
  type: string | null;
  transactionId: string | null;
  originalTransactionId: string | null;
  purchaseDate: number | null;
  error?: string;
}

/**
 * Parse Apple's verification response into our standard format
 */
const parseVerificationResult = (
  data: AppleVerificationResponse,
  environment: 'production' | 'sandbox'
): VerificationResult => {
  // Get the most recent transaction from either latest_receipt_info or in_app
  const latestTransaction = 
    data.latest_receipt_info?.[0] || 
    data.receipt.in_app[data.receipt.in_app.length - 1];

  if (!latestTransaction) {
    return {
      isValid: false,
      expiresDate: null,
      environment,
      productId: null,
      type: null,
      transactionId: null,
      originalTransactionId: null,
      purchaseDate: null,
      error: 'No valid transaction found in receipt'
    };
  }

  const purchaseDate = parseInt(latestTransaction.purchase_date_ms) / 1000;
  const expiresDate = latestTransaction.expires_date_ms 
    ? parseInt(latestTransaction.expires_date_ms) / 1000 
    : null;

  return {
    isValid: true,
    expiresDate,
    environment,
    productId: latestTransaction.product_id,
    type: PRODUCT_ID_MAP[latestTransaction.product_id] || null,
    transactionId: latestTransaction.transaction_id,
    originalTransactionId: latestTransaction.original_transaction_id,
    purchaseDate
  };
};

/**
 * Verify Apple receipt data with retries and sandbox fallback
 */
export const verifyAppleReceipt = async (
  receiptData: string,
  excludeSandbox = false
): Promise<VerificationResult> => {
  try {
    logger.info('Verifying Apple receipt...');

    // Try production environment first
    const productionResponse = await fetch(APPLE_VERIFICATION_ENDPOINTS.production, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'receipt-data': receiptData,
        password: config.appleSharedSecret
      })
    });

    if (!productionResponse.ok) {
      throw new Error(`Apple verification failed with status ${productionResponse.status}`);
    }

    const productionData = await productionResponse.json() as AppleVerificationResponse;

    // Status 21007 indicates a sandbox receipt
    if (productionData.status === 21007 && !excludeSandbox) {
      logger.info('Receipt is from sandbox environment, retrying with sandbox endpoint...');
      
      const sandboxResponse = await fetch(APPLE_VERIFICATION_ENDPOINTS.sandbox, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          'receipt-data': receiptData,
          password: config.appleSharedSecret
        })
      });

      if (!sandboxResponse.ok) {
        throw new Error(`Apple sandbox verification failed with status ${sandboxResponse.status}`);
      }

      const sandboxData = await sandboxResponse.json() as AppleVerificationResponse;
      
      if (sandboxData.status === 0) {
        return parseVerificationResult(sandboxData, 'sandbox');
      }
      
      throw new Error(`Apple sandbox verification returned status ${sandboxData.status}`);
    }

    // Handle other status codes
    if (productionData.status !== 0) {
      const errorMessage = getAppleStatusCodeError(productionData.status);
      throw new Error(errorMessage);
    }

    return parseVerificationResult(productionData, 'production');
  } catch (error) {
    logger.error(`Receipt verification error: ${error instanceof Error ? error.message : String(error)}`);
    return {
      isValid: false,
      expiresDate: null,
      environment: 'unknown',
      productId: null,
      type: null,
      transactionId: null,
      originalTransactionId: null,
      purchaseDate: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

/**
 * Get human-readable error message for Apple status codes
 */
const getAppleStatusCodeError = (status: number): string => {
  const errorMessages: Record<number, string> = {
    21000: 'The App Store could not read the JSON object you provided.',
    21002: 'The data in the receipt-data property was malformed.',
    21003: 'The receipt could not be authenticated.',
    21004: 'The shared secret you provided does not match the shared secret on file for your account.',
    21005: 'The receipt server is not currently available.',
    21006: 'This receipt is valid but the subscription has expired.',
    21007: 'This receipt is from the test environment, but it was sent to the production environment for verification.',
    21008: 'This receipt is from the production environment, but it was sent to the test environment for verification.',
    21010: 'This receipt could not be authorized.',
    21100: 'Internal data access error.',
    21199: 'Unknown error occurred while processing receipt.'
  };

  return errorMessages[status] || `Unknown status code: ${status}`;
};

/**
 * Save a verified subscription to the database
 */
export const saveSubscription = async (
  userId: string,
  receiptData: string,
  verificationResult: VerificationResult
): Promise<number> => {
  return await transaction(async () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      
      // Check if user exists, if not create a minimal record
      const userResult = await query<{ exists: number }>(
        `SELECT 1 as exists FROM users WHERE id = ? LIMIT 1`,
        [userId]
      );
      
      if (!userResult[0]) {
        logger.warn(`User ${userId} not found in database when saving subscription - creating minimal record`);
        
        // Create a minimal user record with a temporary email
        const tempEmail = `${userId}@temporary.vibecheck.app`;
        await run(
          'INSERT INTO users (id, email) VALUES (?, ?)',
          [userId, tempEmail]
        );
        
        logger.info(`Created minimal user record for ${userId} during subscription processing`);
      }
      
      // Check if transaction already exists
      if (verificationResult.transactionId) {
        const existingSubscriptions = await query<Subscription>(
          `SELECT * FROM subscriptions WHERE transactionId = ? LIMIT 1`,
          [verificationResult.transactionId]
        );
        
        if (existingSubscriptions.length > 0) {
          // Update existing subscription
          await run(
            `UPDATE subscriptions 
             SET isActive = ?, 
                 expiresDate = ?, 
                 lastVerifiedDate = ?, 
                 updatedAt = strftime('%s', 'now')
             WHERE id = ?`,
            [
              verificationResult.isValid ? 1 : 0, 
              verificationResult.expiresDate, 
              now, 
              existingSubscriptions[0].id
            ]
          );
          
          return existingSubscriptions[0].id;
        }
      }
      
      // Insert new subscription
      const newSubscription = await query<Subscription>(
        `INSERT INTO subscriptions (
          userId, productId, type, originalTransactionId, transactionId, 
          receiptData, environment, isActive, expiresDate, purchaseDate, 
          lastVerifiedDate
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id`,
        [
          userId,
          verificationResult.productId || 'unknown',
          verificationResult.type || 'unknown',
          verificationResult.originalTransactionId || 'unknown',
          verificationResult.transactionId || 'unknown',
          receiptData,
          verificationResult.environment || 'unknown',
          verificationResult.isValid ? 1 : 0,
          verificationResult.expiresDate,
          verificationResult.purchaseDate || now,
          now
        ]
      );
      
      return newSubscription[0].id;
    } catch (error) {
      logger.error(`Error saving subscription: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  });
};

/**
 * Check if user has an active subscription
 */
export const hasActiveSubscription = async (userId: string): Promise<{
  isActive: boolean;
  expiresDate: number | null;
  type: string | null;
  subscriptionId: number | null;
}> => {
  try {
    // Find most recent active subscription
    const activeSubscriptions = await query<Subscription>(
      `SELECT * FROM subscriptions 
       WHERE userId = ? AND isActive = 1 
       ORDER BY lastVerifiedDate DESC LIMIT 1`,
      [userId]
    );
    
    if (activeSubscriptions.length === 0) {
      return {
        isActive: false,
        expiresDate: null,
        type: null,
        subscriptionId: null
      };
    }
    
    const subscription = activeSubscriptions[0];
    const now = Math.floor(Date.now() / 1000);
    
    // Check if subscription has expired since last verification
    if (subscription.expiresDate && subscription.expiresDate < now) {
      // Update subscription to inactive
      await run(
        `UPDATE subscriptions 
         SET isActive = 0, updatedAt = strftime('%s', 'now') 
         WHERE id = ?`,
        [subscription.id]
      );
      
      return {
        isActive: false,
        expiresDate: subscription.expiresDate,
        type: subscription.type,
        subscriptionId: subscription.id
      };
    }
    
    return {
      isActive: true,
      expiresDate: subscription.expiresDate || null,
      type: subscription.type,
      subscriptionId: subscription.id
    };
  } catch (error) {
    logger.error(`Error checking subscription status: ${error instanceof Error ? error.message : String(error)}`);
    // Return false instead of throwing to avoid breaking the app
    return {
      isActive: false,
      expiresDate: null,
      type: null,
      subscriptionId: null
    };
  }
};

/**
 * Verify receipt and save subscription
 */
export const verifyAndSaveSubscription = async (
  userId: string,
  receiptData: string
): Promise<{
  isValid: boolean;
  expiresDate: number | null;
  type: string | null;
  error?: string;
}> => {
  try {
    // Verify the receipt with Apple
    const verificationResult = await verifyAppleReceipt(receiptData);
    
    if (!verificationResult.isValid) {
      return {
        isValid: false,
        expiresDate: null,
        type: null,
        error: verificationResult.error || 'Invalid receipt'
      };
    }
    
    // Save/update subscription in database
    await saveSubscription(userId, receiptData, verificationResult);
    
    return {
      isValid: verificationResult.isValid,
      expiresDate: verificationResult.expiresDate,
      type: verificationResult.type
    };
  } catch (error) {
    logger.error(`Error verifying and saving subscription: ${error instanceof Error ? error.message : String(error)}`);
    return {
      isValid: false,
      expiresDate: null,
      type: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
};