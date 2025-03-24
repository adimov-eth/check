import { handleWebhookEvent, verifyWebhookSignature } from '@/services/webhook-service';
import type { WebhookResponse } from '@/types/webhook';
import type { Request, Response } from 'express';
import { Router } from 'express';

// Extend Request type to include rawBody
interface SvixWebhookRequest extends Request {
  rawBody?: string;
}

const router = Router();

// Middleware to capture raw body for webhook verification
router.use((req: Request, _res: Response, next) => {
  let data = '';
  req.on('data', chunk => { data += chunk });
  req.on('end', () => {
    (req as SvixWebhookRequest).rawBody = data;
    next();
  });
});

router.post('/', async (req: SvixWebhookRequest, res: Response<WebhookResponse>): Promise<void> => {
  try {
    // Get the raw body
    const rawBody = req.rawBody || JSON.stringify(req.body);
    
    // Verify the webhook signature using Svix headers
    const evt = await verifyWebhookSignature(rawBody, {
      'svix-id': req.headers['svix-id'] as string,
      'svix-timestamp': req.headers['svix-timestamp'] as string,
      'svix-signature': req.headers['svix-signature'] as string,
    });
    
    // Handle the webhook event
    await handleWebhookEvent(evt);
    
    res.json({ success: true, message: 'Webhook processed successfully' });
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(400).json({
      success: false,
      error: `Failed to process webhook: ${(err as Error).message}`
    });
  }
});

export default router; 