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

  // Standard JWT claims that might be present (like in identity tokens)
  sub?: string; // User ID from Apple
  email?: string;
  email_verified?: boolean | string; // Apple uses string sometimes
  is_private_email?: boolean | string; // Apple uses string sometimes
  auth_time?: number;
  nonce_supported?: boolean;
}

interface VerificationResultBase<T extends JWTPayload> {
  isValid: boolean;
  payload?: T;
  error?: string;
}

// Specific result type for the identity token verification
type IdentityTokenVerificationResult = VerificationResultBase<{
    sub: string; // User ID is mandatory here
    iss: string;
    aud: string;
    exp: number;
    iat: number;
    email?: string;
    email_verified?: boolean | string;
    is_private_email?: boolean | string;
    auth_time?: number;
}>;

// General result type for App Store signed data
type NotificationVerificationResult = VerificationResultBase<VerifiedNotificationPayload>;


// Cache for Apple's public keys JWKSet URL
const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');
let appleJWKSet: ReturnType<typeof createRemoteJWKSet> | null = null;
let lastJWKSetFetchTime = 0;
const JWKSET_CACHE_TTL = 60 * 60 * 1000; // Cache JWKSet for 1 hour

// Keep this function internal or export if needed elsewhere, marked internal for now
async function getAppleJWKSet(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    const now = Date.now();
    if (!appleJWKSet || now - lastJWKSetFetchTime > JWKSET_CACHE_TTL) {
        logger.info('Fetching/Refreshing Apple JWKSet...');
        try {
            appleJWKSet = createRemoteJWKSet(APPLE_JWKS_URL);
            lastJWKSetFetchTime = now;
            logger.info('Successfully fetched/refreshed Apple JWKSet.');
        } catch (error) {
             logger.error(`Failed to fetch Apple JWKSet: ${formatError(error)}`);
             // Re-throw the original error to be caught by the caller
             throw error;
        }
    }
    return appleJWKSet;
}

/**
 * Verifies an Apple *Identity Token* (JWS) using jose.
 * Specifically checks claims relevant to Sign in with Apple.
 */
export const verifyAppleIdentityTokenJws = async (identityToken: string): Promise<IdentityTokenVerificationResult> => {
    try {
        const jwkSet = await getAppleJWKSet();

        const { payload } = await jwtVerify(identityToken, jwkSet, {
            issuer: 'https://appleid.apple.com',
            audience: config.appleBundleId, // Verify audience matches our app's bundle ID
            // Default clock tolerance is used for exp/nbf checks
        });

        // --- Specific Payload Validations for Identity Token ---

        // 1. Check if 'sub' (user identifier) exists - crucial for identity tokens
        if (!payload.sub || typeof payload.sub !== 'string') {
             throw new Error('Verified payload is missing required "sub" (subject) claim.');
        }

        // Note: Email and name are often only present on the *first* sign-in token.
        // Their absence is not necessarily an error after the first time.

        logger.info(`Successfully verified Apple identity token JWS for user sub: ${payload.sub}`);

        // Cast to the specific payload type for the return value
        const identityPayload = payload as IdentityTokenVerificationResult['payload'];

        return {
            isValid: true,
            payload: identityPayload,
        };

    } catch (error: unknown) {
        const errorMessage = formatError(error);
        // Log specific jose errors if available
        if (error instanceof Error) {
             if (error.name === 'JWSSignatureVerificationFailed') {
                logger.error(`Apple Identity Token JWS verification failed: Invalid Signature. ${errorMessage}`);
             } else if (error.name === 'JWKSetNoMatchingKey') {
                  logger.error(`Apple Identity Token JWS verification failed: No matching key found in JWKSet. ${errorMessage}`);
             } else if (error.name === 'JWTExpired') {
                  logger.error(`Apple Identity Token JWS verification failed: Token expired. ${errorMessage}`);
             } else if (error.name === 'JWTClaimValidationFailed') {
                  logger.error(`Apple Identity Token JWS verification failed: Claim validation failed (e.g., iss, aud). ${errorMessage}`);
             } else {
                 logger.error(`Apple Identity Token JWS verification failed: ${errorMessage}`);
             }
        } else {
             logger.error(`Apple Identity Token JWS verification failed: ${errorMessage}`);
        }
        return { isValid: false, error: errorMessage };
    }
};


/**
 * Verifies signed data from App Store Server Notifications or /verifyReceipt endpoint.
 */
export const verifyAppleSignedData = async (signedData: string): Promise<NotificationVerificationResult> => {
    try {
        const jwkSet = await getAppleJWKSet();

        const { payload } = await jwtVerify(signedData, jwkSet, {
            // For App Store server data, the issuer might vary or be absent? Check docs.
            // Let's assume it might not always be 'https://appleid.apple.com' for transaction/renewal info.
            // If it *is* always Apple, add: issuer: 'https://appleid.apple.com'
            // Audience is typically not present/relevant for transaction/renewal info JWS.
        });

        // Cast payload to our expected interface AFTER successful verification
        const verifiedPayload = payload as VerifiedNotificationPayload;

        // --- Additional Payload Validations for App Store Data ---

        // 1. Check Bundle ID
        if (verifiedPayload.bundleId !== config.appleBundleId) {
             throw new Error(`Payload bundleId (${verifiedPayload.bundleId}) does not match expected (${config.appleBundleId})`);
        }

        // 2. Check Environment
        const expectedEnv = config.nodeEnv === 'production' ? 'Production' : 'Sandbox';
        if (verifiedPayload.environment !== expectedEnv) {
            // This might be okay if testing sandbox in prod or vice-versa, but log it.
            logger.warn(`Payload environment (${verifiedPayload.environment}) does not match server environment (${expectedEnv}). Processing anyway, but check configuration.`);
        }

        // 3. Check for necessary fields specific to transaction/renewal info
        if (!verifiedPayload.originalTransactionId || !verifiedPayload.transactionId || !verifiedPayload.productId || !verifiedPayload.type) {
             throw new Error('Verified payload is missing essential App Store fields (originalTransactionId, transactionId, productId, type)');
        }


        logger.info(`Successfully verified App Store signed data JWS. Transaction ID: ${verifiedPayload.transactionId}`);
        return {
            isValid: true,
            payload: verifiedPayload,
        };

    } catch (error) {
        const errorMessage = formatError(error);
        logger.error(`Apple App Store signed data JWS verification failed: ${errorMessage}`);
        return { isValid: false, error: errorMessage };
    }
}; 