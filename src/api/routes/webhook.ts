import {
  captureRawBody,
  validateWebhookRequest,
  webhookBodyParser,
  type WebhookRequest
} from '@/middleware/webhook';
import { handleWebhookEvent, verifyWebhookSignature } from '@/services/webhook-service';
import type { WebhookResponse } from '@/types/webhook';
import { logger } from '@/utils/logger';
import type { WebhookEvent } from '@clerk/backend';
import type { Response } from 'express';
import { Router } from 'express';

const router = Router();

// Apply middlewares in order
router.use(webhookBodyParser);
router.use(captureRawBody);
router.use(validateWebhookRequest);

const WEBHOOK_TIMEOUT = 5000; // Reduced to 5 seconds since we're only verifying signature

router.post('/clerk', async (req: WebhookRequest, res: Response<WebhookResponse>): Promise<void> => {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Webhook signature verification timeout')), WEBHOOK_TIMEOUT);
  });

  try {
    // Log the incoming webhook request
    logger.info('Received Clerk webhook', {
      method: req.method,
      path: req.path,
      headers: {
        'svix-id': req.headers['svix-id'],
        'svix-timestamp': req.headers['svix-timestamp'],
        'content-type': req.headers['content-type']
      }
    });

    // Get the raw body and log its presence
    const rawBody = req.rawBody || JSON.stringify(req.body);
    logger.debug('Processing webhook payload', { 
      hasRawBody: !!req.rawBody,
      bodyLength: rawBody.length,
      contentType: req.headers['content-type']
    });
    
    // Only verify the signature before responding
    const evt = await Promise.race<WebhookEvent>([
      verifyWebhookSignature(rawBody, {
        'svix-id': req.headers['svix-id'] as string,
        'svix-timestamp': req.headers['svix-timestamp'] as string,
        'svix-signature': req.headers['svix-signature'] as string,
      }),
      timeoutPromise
    ]);
    
    // Send immediate acknowledgment to Clerk after signature verification
    res.status(202).json({ 
      success: true, 
      message: 'Webhook received and signature verified' 
    });

    // Log successful verification
    logger.info('Webhook signature verified, processing asynchronously', { 
      type: evt.type,
      userId: evt.data?.id,
      eventId: req.headers['svix-id']
    });

    // Process the webhook event asynchronously
    setImmediate(async () => {
      try {
        await handleWebhookEvent(evt);
        logger.info('Webhook processed successfully', {
          type: evt.type,
          userId: evt.data?.id,
          eventId: req.headers['svix-id']
        });
      } catch (err) {
        logger.error('Async webhook processing error:', {
          error: (err as Error).message,
          type: evt.type,
          userId: evt.data?.id,
          eventId: req.headers['svix-id']
        });
      }
    });

  } catch (err) {
    const error = err as Error;
    logger.error('Webhook signature verification error:', {
      error: error.message,
      stack: error.stack,
      headers: req.headers
    });
    
    res.status(400).json({
      success: false,
      error: `Failed to verify webhook signature: ${error.message}`
    });
  }
});

export default router; 