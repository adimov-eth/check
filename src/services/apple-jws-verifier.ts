import { config } from '@/config'; // Import config for bundleId and environment
import { formatError } from '@/utils/error-formatter';
import { logger } from '@/utils/logger';
import { type JWTPayload, createRemoteJWKSet, jwtVerify } from 'jose';

// Define the expected payload structure *after* verification & decoding
// Based on: https://developer.apple.com/documentation/appstoreserverapi/jwstransaction
// And: https://developer.apple.com/documentation/appstoreserverapi/jwsrenewalinfopayload
export interface VerifiedNotificationPayload extends JWTPayload {
  originalTransactionId: string;
  transactionId: string;
  productId: string;
  purchaseDate: number; // ms timestamp
  expiresDate?: number; // ms timestamp, may not be present for consumables/refunds etc.
  quantity: number;
  type: 'Auto-Renewable Subscription' | 'Non-Consumable' | 'Consumable' | 'Non-Renewing Subscription';
  appAccountToken?: string; // UUID if set during purchase
  bundleId: string;
  environment: 'Sandbox' | 'Production';
  // Add other potentially useful fields:
  inAppOwnershipType?: 'PURCHASED' | 'FAMILY_SHARED';
  webOrderLineItemId?: string; // Can be useful for linking
  revocationReason?: number;
  revocationDate?: number; // ms timestamp
  isUpgraded?: boolean;
  offerType?: number; // 1: Intro, 2: Promo, 3: Subscription Offer Code
  offerIdentifier?: string;
  subscriptionGroupIdentifier?: string;
  // Fields specific to RenewalInfo
  autoRenewProductId?: string;
  autoRenewStatus?: number; // 0: Off, 1: On
  isInBillingRetryPeriod?: boolean;
  priceIncreaseStatus?: number; // 0: Not responded, 1: Consented
  gracePeriodExpiresDate?: number; // ms timestamp
  signedDate: number; // ms timestamp (from the renewalInfo itself)
}

interface VerificationResult {
  isValid: boolean;
  payload?: VerifiedNotificationPayload;
  error?: string;
}

// Cache for Apple's public keys JWKSet URL
const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');
let appleJWKSet: ReturnType<typeof createRemoteJWKSet> | null = null;
let lastJWKSetFetchTime = 0;
const JWKSET_CACHE_TTL = 60 * 60 * 1000; // Cache JWKSet for 1 hour

async function getAppleJWKSet(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    const now = Date.now();
    if (!appleJWKSet || now - lastJWKSetFetchTime > JWKSET_CACHE_TTL) {
        logger.info('Fetching/Refreshing Apple JWKSet...');
        try {
            // createRemoteJWKSet handles fetching and caching internally based on HTTP headers
            // We add our own TTL layer just in case.
            appleJWKSet = createRemoteJWKSet(APPLE_JWKS_URL, {
                // Optional: Add custom fetch options if needed (e.g., timeout)
                // agent: // custom http agent if needed
            });
            lastJWKSetFetchTime = now;
            logger.info('Successfully fetched/refreshed Apple JWKSet.');
        } catch (error) {
             logger.error(`Failed to fetch Apple JWKSet: ${formatError(error)}`);
             throw new Error(`Failed to fetch Apple JWKSet: ${formatError(error)}`);
        }

    }
    return appleJWKSet;
}


export const verifyAppleSignedData = async (signedData: string): Promise<VerificationResult> => {
    try {
        const jwkSet = await getAppleJWKSet();

        // Destructure only the payload, as protectedHeader is not used
        const { payload } = await jwtVerify(signedData, jwkSet, {
            issuer: 'https://appleid.apple.com',
            // Audience validation happens inside the payload check below
        });

        // Cast payload to our expected interface AFTER successful verification
        const verifiedPayload = payload as VerifiedNotificationPayload;

        // --- Additional Payload Validations ---

        // 1. Check Bundle ID
        if (verifiedPayload.bundleId !== config.appleBundleId) {
             throw new Error(`Payload bundleId (${verifiedPayload.bundleId}) does not match expected (${config.appleBundleId})`);
        }

        // 2. Check Environment (optional but recommended)
        const expectedEnv = config.nodeEnv === 'production' ? 'Production' : 'Sandbox';
        if (verifiedPayload.environment !== expectedEnv) {
            logger.warn(`Payload environment (${verifiedPayload.environment}) does not match server environment (${expectedEnv}). Processing anyway, but check configuration.`);
        }

        // 3. Check for necessary fields
        if (!verifiedPayload.originalTransactionId || !verifiedPayload.transactionId || !verifiedPayload.productId || !verifiedPayload.type) {
             throw new Error('Verified payload is missing essential fields (originalTransactionId, transactionId, productId, type)');
        }


        logger.info(`Successfully verified JWS. Transaction ID: ${verifiedPayload.transactionId}`);
        return {
            isValid: true,
            payload: verifiedPayload,
        };

    } catch (error) {
        logger.error(`Apple JWS verification failed: ${formatError(error)}`);
        return { isValid: false, error: formatError(error) };
    }
}; 