import { deleteUser, upsertUser } from '@/services/user-service';
import type { WebhookEventType } from '@/types/webhook';
import { logger } from '@/utils/logger';
import type { SessionJSON, UserJSON, WebhookEvent } from '@clerk/backend';
import { Webhook } from 'svix';

const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

if (!WEBHOOK_SECRET) {
  throw new Error('Missing CLERK_WEBHOOK_SECRET environment variable');
}

// Log webhook secret prefix to help debug production vs development credentials
logger.info('Webhook configuration initialized', {
  webhookSecretPrefix: WEBHOOK_SECRET.startsWith('whsec_test_') ? 'test' : 'live',
  environment: process.env.NODE_ENV
});

export const verifyWebhookSignature = async (
  payload: string,
  headers: {
    'svix-id'?: string;
    'svix-timestamp'?: string;
    'svix-signature'?: string;
  }
): Promise<WebhookEvent> => {
  logger.debug('Verifying webhook signature', { 
    hasPayload: !!payload,
    payloadLength: payload.length,
    headers: {
      hasId: !!headers['svix-id'],
      hasTimestamp: !!headers['svix-timestamp'],
      hasSignature: !!headers['svix-signature'],
      signaturePrefix: headers['svix-signature']?.substring(0, 10) + '...',
      timestamp: headers['svix-timestamp']
    }
  });

  if (!headers['svix-id'] || !headers['svix-timestamp'] || !headers['svix-signature']) {
    throw new Error('Missing required Svix headers');
  }

  const wh = new Webhook(WEBHOOK_SECRET);
  
  try {
    const evt = await wh.verify(payload, {
      'svix-id': headers['svix-id'],
      'svix-timestamp': headers['svix-timestamp'],
      'svix-signature': headers['svix-signature'],
    }) as WebhookEvent;
    
    logger.debug('Webhook signature verified successfully', {
      eventType: evt.type,
      eventId: headers['svix-id'],
      timestamp: new Date(Number(headers['svix-timestamp']) * 1000).toISOString()
    });
    return evt;
  } catch (err) {
    logger.error('Failed to verify webhook signature', { 
      error: (err as Error).message,
      payload: payload.substring(0, 100) + '...', // Log first 100 chars for debugging
      headers: {
        id: headers['svix-id'],
        timestamp: headers['svix-timestamp'],
        signaturePrefix: headers['svix-signature']?.substring(0, 10) + '...'
      }
    });
    throw new Error(`Failed to verify webhook signature: ${(err as Error).message}`);
  }
};

export const handleWebhookEvent = async (event: WebhookEvent): Promise<void> => {
  const eventType = event.type as WebhookEventType;
  const data = event.data;

  logger.debug('Handling webhook event', { 
    type: eventType,
    dataKeys: Object.keys(data)
  });

  switch (eventType) {
    case 'user.created':
    case 'user.updated': {
      const userData = data as UserJSON;
      const primaryEmail = userData.email_addresses[0]?.email_address;
      
      if (!primaryEmail) {
        logger.warn(`User ${eventType} event received without email address`, { 
          userId: userData.id 
        });
        return;
      }

      try {
        await upsertUser({
          id: userData.id,
          email: primaryEmail,
          name: userData.first_name || undefined,
        });
        logger.info(`User ${eventType} processed successfully`, { 
          userId: userData.id,
          email: primaryEmail
        });
      } catch (error) {
        logger.error(`Failed to ${eventType === 'user.created' ? 'create' : 'update'} user`, {
          error: (error as Error).message,
          userId: userData.id
        });
        throw error;
      }
      break;
    }
    case 'user.deleted': {
      const userData = data as UserJSON;
      try {
        await deleteUser(userData.id);
        logger.info('User deleted successfully', { userId: userData.id });
      } catch (error) {
        logger.error('Failed to delete user', {
          error: (error as Error).message,
          userId: userData.id
        });
        throw error;
      }
      break;
    }
    case 'session.created':
    case 'session.ended':
    case 'session.removed': {
      const sessionData = data as SessionJSON;
      logger.info(`Session ${eventType} processed`, { 
        sessionId: sessionData.id,
        userId: sessionData.user_id
      });
      break;
    }
    default:
      logger.warn('Unhandled webhook event type', { type: eventType });
  }
}; 