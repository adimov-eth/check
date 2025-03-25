import { getUserId, requireAuth } from '@/middleware/auth';
import { AuthenticationError, NotFoundError, ValidationError } from '@/middleware/error';
import { conversationsRateLimiter } from '@/middleware/rate-limit';
import { gptQueue } from '@/queues';
import {
  createConversation,
  getConversationById,
  getUserConversations,
  updateConversationStatus
} from '@/services/conversation-service';
import { canCreateConversation } from '@/services/usage-service';
import { logger } from '@/utils/logger';
import type { ExpressRequestWithAuth } from '@clerk/express';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';

const router = Router();

// Apply rate limiting to all conversation routes
router.use(conversationsRateLimiter);

// Schema for creating a conversation
const createConversationSchema = z.object({
  mode: z.string().min(1),
  recordingType: z.union([z.literal('separate'), z.literal('live')]),
});

// type CreateConversationBody = z.infer<typeof createConversationSchema>;

// Create a new conversation
router.post('/', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = getUserId(req as ExpressRequestWithAuth);
    if (!userId) {
      throw new AuthenticationError('Unauthorized: No user ID found');
    }

    // Validate request body
    const validationResult = createConversationSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError(`Invalid request: ${validationResult.error.message}`);
    }

    // Check if user can create a new conversation (usage limits)
    const usageCheck = await canCreateConversation(userId);
    if (!usageCheck.canCreate) {
      res.status(403).json({ 
        error: 'Usage limit reached',
        reason: usageCheck.reason,
        status: 403
      });
      return;
    }

    const { mode, recordingType } = validationResult.data;
    const conversation = await createConversation({
      userId,
      mode,
      recordingType,
    });

    logger.debug(`Created new conversation: ${conversation.id} for user: ${userId}`);
    res.status(201).json({ 
      success: true,
      conversation: {
        id: conversation.id,
        mode,
        recordingType,
        status: 'created'
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get a conversation by ID
router.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new AuthenticationError('Unauthorized: No user ID found');
    }

    const conversation = await getConversationById(req.params.id, userId);
    if (!conversation) {
      throw new NotFoundError(`Conversation not found: ${req.params.id}`);
    }

    logger.debug(`Retrieved conversation: ${req.params.id} for user: ${userId}`);
    res.status(200).json({ conversation });
  } catch (error) {
    next(error);
  }
});

// Get all conversations for a user
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new AuthenticationError('Unauthorized: No user ID found');
    }

    const conversations = await getUserConversations(userId);
    logger.debug(`Retrieved ${conversations.length} conversations for user: ${userId}`);
    res.status(200).json({ conversations });
  } catch (error) {
    next(error);
  }
});

// Process a conversation with GPT
router.post('/:id/process', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new AuthenticationError('Unauthorized: No user ID found');
    }

    const conversationId = req.params.id;
    const conversation = await getConversationById(conversationId, userId);

    if (!conversation) {
      throw new NotFoundError(`Conversation not found: ${conversationId}`);
    }

    if (conversation.status === 'processing') {
      throw new ValidationError('Conversation is already being processed');
    }

    await updateConversationStatus(conversationId, 'processing');
    await gptQueue.add('process-conversation', { conversationId, userId });

    logger.debug(`Started processing conversation: ${conversationId} for user: ${userId}`);
    res.status(202).json({ 
      message: 'Processing started', 
      conversationId 
    });
  } catch (error) {
    next(error);
  }
});

export default router;