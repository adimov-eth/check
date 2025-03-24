import { deleteUser, upsertUser } from '@/services/user-service';
import type { WebhookEventType } from '@/types/webhook';
import type { SessionJSON, UserJSON, WebhookEvent } from '@clerk/backend';
import { Webhook } from 'svix';

const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

if (!WEBHOOK_SECRET) {
  throw new Error('Missing CLERK_WEBHOOK_SECRET environment variable');
}

export const verifyWebhookSignature = async (
  payload: string,
  headers: {
    'svix-id'?: string;
    'svix-timestamp'?: string;
    'svix-signature'?: string;
  }
): Promise<WebhookEvent> => {
  const wh = new Webhook(WEBHOOK_SECRET);
  
  try {
    const evt = await wh.verify(payload, {
      'svix-id': headers['svix-id'] || '',
      'svix-timestamp': headers['svix-timestamp'] || '',
      'svix-signature': headers['svix-signature'] || '',
    }) as WebhookEvent;
    
    return evt;
  } catch (err) {
    throw new Error(`Failed to verify webhook signature: ${(err as Error).message}`);
  }
};

export const handleWebhookEvent = async (event: WebhookEvent): Promise<void> => {
  const eventType = event.type as WebhookEventType;
  const data = event.data;

  switch (eventType) {
    case 'user.created':
    case 'user.updated': {
      const userData = data as UserJSON;
      const primaryEmail = userData.email_addresses[0]?.email_address;
      
      if (!primaryEmail) {
        console.warn(`User ${eventType} event received without email address:`, userData.id);
        return;
      }

      await upsertUser({
        id: userData.id,
        email: primaryEmail,
        name: userData.first_name || undefined,
      });
      console.log(`User ${eventType}:`, userData.id);
      break;
    }
    case 'user.deleted': {
      const userData = data as UserJSON;
      await deleteUser(userData.id);
      console.log('User deleted:', userData.id);
      break;
    }
    case 'session.created':
    case 'session.ended':
    case 'session.removed': {
      const sessionData = data as SessionJSON;
      console.log(`Session ${eventType}:`, sessionData.id);
      break;
    }
    default:
      console.warn('Unhandled webhook event type:', eventType);
  }
}; 