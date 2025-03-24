import { getUserId, requireAuth } from '@/middleware/auth';
import { AuthenticationError, ValidationError } from '@/middleware/error';
import { hasActiveSubscription, verifyAndSaveSubscription } from '@/services/subscription-serivice';
import { logger } from '@/utils/logger';
import type { ExpressRequestWithAuth } from '@clerk/express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';

const router = Router();

// Apply auth middleware to all routes except notifications
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/notifications') {
    return next();
  }
  return requireAuth(req as ExpressRequestWithAuth, res, next);
});

// Validation schemas
export const verifyReceiptSchema = z.object({
  receiptData: z.string().min(1, "Receipt data is required"),
});

export const appStoreNotificationSchema = z.object({
  notificationType: z.string(),
  notificationUUID: z.string(),
  data: z.object({
    signedTransactionInfo: z.string().optional(),
    signedRenewalInfo: z.string().optional(),
    environment: z.string().optional(),
  }),
});

// Verify receipt endpoint
router.post('/verify', (async (req: ExpressRequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      throw new AuthenticationError('Unauthorized: No user ID found');
    }

    const validationResult = verifyReceiptSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError(`Invalid request: ${validationResult.error.message}`);
    }

    const { receiptData } = validationResult.data;
    logger.info(`Verifying receipt for user: ${userId}`);

    const result = await verifyAndSaveSubscription(userId, receiptData);
    if (!result.isValid) {
      throw new ValidationError(result.error || 'Receipt verification failed');
    }

    res.status(200).json({
      success: true,
      subscription: {
        isValid: result.isValid,
        type: result.type,
        expiresDate: result.expiresDate
      }
    });
  } catch (error) {
    next(error);
  }
}) as RequestHandler);

// Get subscription status endpoint
router.get('/status', (async (req: ExpressRequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      throw new AuthenticationError('Unauthorized: No user ID found');
    }

    const subscription = await hasActiveSubscription(userId);
    logger.debug(`Retrieved subscription status for user: ${userId}`);
    
    res.status(200).json({
      isSubscribed: subscription.isActive,
      subscription: {
        type: subscription.type,
        expiresDate: subscription.expiresDate
      }
    });
  } catch (error) {
    next(error);
  }
}) as RequestHandler);

// App Store notifications webhook endpoint
router.post('/notifications', (async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info('Received App Store notification');

    const validationResult = appStoreNotificationSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError(`Invalid notification format: ${validationResult.error.message}`);
    }

    const notification = validationResult.data;
    logger.info(`Processing App Store notification: ${notification.notificationType}`);

    // TODO: Handle App Store notification
    // This would typically involve verifying the notification and updating subscription status

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
}) as RequestHandler);

export default router;
