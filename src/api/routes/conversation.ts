import { requireAuth, requireResourceOwnership } from '@/middleware/auth';
import { ValidationError } from '@/middleware/error';
import { conversationsRateLimiter } from '@/middleware/rate-limit';
import { gptQueue } from '@/queues';
import {
  createConversation,
  getConversationById,
  getUserConversations,
  updateConversationStatus
} from '@/services/conversation-service';
import { canCreateConversation } from '@/services/usage-service';
import type { Conversation } from '@/types';
import type { AuthenticatedRequest, RequestHandler } from '@/types/common';
import { asyncHandler } from '@/utils/async-handler';
import { logger } from '@/utils/logger';
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

/**
 * Create a new conversation
 */
const createNewConversation: RequestHandler = async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  // Validate request body
  const validationResult = createConversationSchema.safeParse(req.body);
  if (!validationResult.success) {
    throw new ValidationError(`Invalid request: ${validationResult.error.message}`);
  }

  // Check if user can create a new conversation (usage limits)
  const usageCheck = await canCreateConversation(userId);
  if (!usageCheck.canCreate) {
    return res.status(403).json({ 
      error: 'Usage limit reached',
      reason: usageCheck.reason,
      status: 403
    });
  }

  const { mode, recordingType } = validationResult.data;
  const conversation = await createConversation({
    userId,
    mode,
    recordingType,
  });

  logger.debug(`Created new conversation: ${conversation.id} for user: ${userId}`);
  return res.status(201).json({ 
    success: true,
    conversation: {
      id: conversation.id,
      mode,
      recordingType,
      status: 'created'
    }
  });
};

/**
 * Get a conversation by ID
 */
const getConversation: RequestHandler = async (req, res) => {
  const { resource, userId } = req as AuthenticatedRequest;
  const conversation = resource as Conversation;

  logger.debug(`Retrieved conversation: ${req.params.id} for user: ${userId}`);
  return res.status(200).json({ conversation });
};

/**
 * Get all conversations for a user
 */
const getAllConversations: RequestHandler = async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const conversations = await getUserConversations(userId);
  logger.debug(`Retrieved ${conversations.length} conversations for user: ${userId}`);
  return res.status(200).json({ conversations });
};

/**
 * Process a conversation with GPT
 */
const processConversation: RequestHandler = async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const conversation = (req as AuthenticatedRequest).resource as Conversation;
  const conversationId = req.params.id;

  if (conversation.status === 'processing') {
    throw new ValidationError('Conversation is already being processed');
  }

  await updateConversationStatus(conversationId, 'processing');
  await gptQueue.add('process-conversation', { conversationId, userId });

  logger.debug(`Started processing conversation: ${conversationId} for user: ${userId}`);
  return res.status(202).json({ 
    message: 'Processing started', 
    conversationId 
  });
};

// Define routes with middleware
router.post('/', requireAuth, asyncHandler(createNewConversation));
router.get('/:id', requireAuth, requireResourceOwnership(getConversationById, 'Conversation'), asyncHandler(getConversation));
router.get('/', requireAuth, asyncHandler(getAllConversations));
router.post('/:id/process', requireAuth, requireResourceOwnership(getConversationById, 'Conversation'), asyncHandler(processConversation));

export default router;