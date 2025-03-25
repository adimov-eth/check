import {
  captureRawBody,
  validateWebhookRequest,
  webhookBodyParser,
  type WebhookRequest
} from '@/middleware/webhook';
import { handleWebhookEvent, verifyWebhookSignature } from '@/services/webhook-service';
import type { WebhookResponse } from '@/types/webhook';
import { logger } from '@/utils/logger';
import type { Response } from 'express';
import { Router } from 'express';

const router = Router();

// Apply middlewares in order
router.use(webhookBodyParser);
router.use(captureRawBody);
router.use(validateWebhookRequest);

const WEBHOOK_TIMEOUT = 10000; // 10 seconds

router.post('/clerk', async (req: WebhookRequest, res: Response<WebhookResponse>): Promise<void> => {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Webhook processing timeout')), WEBHOOK_TIMEOUT);
  });

  try {
    logger.debug('Processing webhook', {
      headers: {
        'svix-id': req.headers['svix-id'],
        'svix-timestamp': req.headers['svix-timestamp'],
        'content-type': req.headers['content-type']
      }
    });

    // Get the raw body
    const rawBody = req.rawBody || JSON.stringify(req.body);
    logger.debug('Webhook raw body', { rawBody });
    
    // Verify the webhook signature using Svix headers
    const evt = await verifyWebhookSignature(rawBody, {
      'svix-id': req.headers['svix-id'] as string,
      'svix-timestamp': req.headers['svix-timestamp'] as string,
      'svix-signature': req.headers['svix-signature'] as string,
    });
    
    logger.info('Webhook signature verified', { 
      type: evt.type,
      userId: evt.data?.id
    });

    // Handle the webhook event
    await Promise.race([handleWebhookEvent(evt), timeoutPromise]);
    
    logger.info('Webhook processed successfully');
    res.json({ success: true, message: 'Webhook processed successfully' });
  } catch (err) {
    logger.error('Webhook processing error:', err);
    res.status(400).json({
      success: false,
      error: `Failed to process webhook: ${(err as Error).message}`
    });
  }
});

export default router; 