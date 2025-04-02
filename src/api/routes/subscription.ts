import { getUserId, requireAuth } from '@/middleware/auth';
import { ensureUser } from '@/middleware/ensure-user';
import { AuthenticationError } from '@/middleware/error';
import { verifyAppleSignedData } from '@/services/apple-jws-verifier';
import { hasActiveSubscription, updateSubscriptionFromNotification, verifyAndSaveSubscription } from '@/services/subscription-serivice';
import type { AuthenticatedRequest } from '@/types/common';
import { asyncHandler } from '@/utils/async-handler';
import { formatError } from '@/utils/error-formatter';
import { logger } from '@/utils/logger';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';

const router = Router();

router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/notifications' && req.method === 'POST') {
    logger.debug("Notifications route hit, bypassing user auth middleware.");
    return next();
  }
  logger.debug(`Applying auth middleware to ${req.method} ${req.path}`);
  requireAuth(req, res, (authError) => {
    if (authError) return next(authError);
    ensureUser(req, res, next);
  });
});

const verifySubscriptionSchema = z.object({
  receiptData: z.string(),
});

export const appStoreNotificationSchema = z.object({
  signedPayload: z.string().optional(),
  notificationType: z.string().optional(),
  subtype: z.string().optional().nullable(),
  notificationUUID: z.string().optional(),
  data: z.object({
    appAppleId: z.number().optional().nullable(),
    bundleId: z.string().optional().nullable(),
    bundleVersion: z.string().optional().nullable(),
    environment: z.string().optional().nullable(),
    signedTransactionInfo: z.string().optional().nullable(),
    signedRenewalInfo: z.string().optional().nullable(),
  }).optional(),
  version: z.string().optional().nullable(),
  signedDate: z.number().optional().nullable(),
});

router.get('/status', asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const userId = getUserId(authReq);
  if (!userId) {
    throw new AuthenticationError('Unauthorized: No user ID found in /status after auth middleware');
  }

  const subscription = await hasActiveSubscription(userId);
  logger.debug(`Retrieved subscription status for user: ${userId}. Active: ${subscription.isActive}`);

  const expiresDateMs = subscription.expiresDate ? Math.round(subscription.expiresDate) : null;

  res.status(200).json({
    subscription: {
      isActive: subscription.isActive,
      expiresDate: expiresDateMs,
      type: subscription.type,
      subscriptionId: subscription.subscriptionId,
    },
  });
}));

router.post('/verify', asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const userId = getUserId(authReq);
  if (!userId) {
    throw new AuthenticationError('Unauthorized: User ID missing in /verify endpoint.');
  }

  logger.info(`Subscription verification request received for user: ${userId}`);

  const validationResult = verifySubscriptionSchema.safeParse(req.body);
  if (!validationResult.success) {
    logger.error(`Invalid /verify request body for user ${userId}: ${validationResult.error.message}`);
    return res.status(400).json({ error: `Invalid request format: ${validationResult.error.message}` });
  }

  const { receiptData } = validationResult.data;

  const verificationResult = await verifyAppleSignedData(receiptData);

  if (!verificationResult.isValid || !verificationResult.payload) {
    logger.error(`Apple signed data verification failed during /verify for user ${userId}: ${verificationResult.error || 'Unknown reason'}`);
    return res.status(400).json({ error: `Signed data verification failed: ${verificationResult.error}` });
  }

  const payload = verificationResult.payload;
  logger.info(`Successfully verified signed data for /verify. User: ${userId}, Transaction ID: ${payload.transactionId}, OrigTxID: ${payload.originalTransactionId}`);

  const saveResult = await verifyAndSaveSubscription(userId, payload);

  if (!saveResult.success) {
    logger.error(`Failed to save subscription from /verify for user ${userId}: ${formatError(saveResult.error)} (OrigTxID: ${payload.originalTransactionId})`);
    return res.status(500).json({ error: 'Failed to process subscription verification.' });
  }

  const currentStatus = await hasActiveSubscription(userId);
  const expiresDateMs = currentStatus.expiresDate ? Math.round(currentStatus.expiresDate) : null;

  logger.info(`Successfully processed /verify request for user ${userId}, original transaction ${payload.originalTransactionId}`);
  res.status(200).json({
    message: 'Subscription verified successfully.',
    subscription: {
      isActive: currentStatus.isActive,
      expiresDate: expiresDateMs,
      type: currentStatus.type,
      subscriptionId: currentStatus.subscriptionId
    }
  });
}));

router.post('/notifications', asyncHandler(async (req: Request, res: Response) => {
  logger.info(`Received App Store notification headers: ${JSON.stringify(req.headers)}`);
  logger.info(`Received App Store notification body (start): ${JSON.stringify(req.body).substring(0, 300)}...`);

  const validationResult = appStoreNotificationSchema.safeParse(req.body);
  if (!validationResult.success) {
    logger.error(`Invalid notification format: ${validationResult.error.message}. Body: ${JSON.stringify(req.body)}`);
    return res.status(400).json({ error: `Invalid notification format: ${validationResult.error.message}` });
  }

  const notification = validationResult.data;

  const signedData = notification.signedPayload || notification.data?.signedTransactionInfo || notification.data?.signedRenewalInfo;

  if (!signedData) {
    logger.warn(`Notification received without signedPayload, signedTransactionInfo, or signedRenewalInfo. Type: ${notification.notificationType || 'Unknown'}. Skipping.`);
    return res.status(200).json({ success: true, message: "Notification received but no signed data found to process." });
  }

  logger.info(`Processing signed data from notification. Type: ${notification.notificationType || 'N/A'}, Subtype: ${notification.subtype || 'N/A'}, Env: ${notification.data?.environment || 'Unknown'}`);

  const verificationResult = await verifyAppleSignedData(signedData);

  if (!verificationResult.isValid || !verificationResult.payload) {
    logger.error(`App Store signed data verification failed: ${verificationResult.error || 'Unknown reason'}. Data: ${signedData.substring(0, 100)}...`);
    return res.status(500).json({ error: `Signed data verification failed: ${verificationResult.error}` });
  }

  const payload = verificationResult.payload;
  logger.info(`Successfully verified signed data. Transaction ID: ${payload.transactionId}, Original Transaction ID: ${payload.originalTransactionId}, Environment: ${payload.environment}`);

  const updateResult = await updateSubscriptionFromNotification(payload);

  if (!updateResult.success) {
    logger.error(`Failed to update subscription from notification: ${formatError(updateResult.error)} (OrigTxID: ${payload.originalTransactionId})`);
    return res.status(500).json({ error: `Failed to process notification: ${formatError(updateResult.error)}` });
  }

  logger.info(`Successfully processed App Store notification for original transaction ${payload.originalTransactionId}`);
  res.status(200).json({ success: true });
}));

export default router;