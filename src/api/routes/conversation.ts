// /Users/adimov/Developer/final/check/src/api/routes/conversation.ts
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
import { log } from '@/utils/logger';
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
    // --- FIX: Remove return ---
    res.status(403).json({
      error: 'Usage limit reached',
      reason: usageCheck.reason,
      status: 403
    });
    return; // Use return; to exit early without returning the response object
    // --- End Fix ---
  }

  const { mode, recordingType } = validationResult.data;
  const conversation = await createConversation({
    userId,
    mode,
    recordingType,
  });

  log.debug(`Created new conversation`, { conversationId: conversation.id, userId });
  // --- FIX: Remove return ---
  res.status(201).json({
    success: true,
    conversation: {
      id: conversation.id,
      mode,
      recordingType,
      status: 'created'
    }
  });
  // --- End Fix ---
};

/**
 * Get a conversation by ID
 */
const getConversation: RequestHandler = async (req, res) => {
  const { resource, userId } = req as AuthenticatedRequest;
  const conversation = resource as Conversation;

  log.debug(`Retrieved conversation`, { conversationId: req.params.id, userId });
  // --- FIX: Remove return ---
  res.status(200).json({ conversation });
  // --- End Fix ---
};

/**
 * Get all conversations for a user
 */
const getAllConversations: RequestHandler = async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const conversations = await getUserConversations(userId);
  log.debug(`Retrieved conversations`, { count: conversations.length, userId });
  // --- FIX: Remove return ---
  res.status(200).json({ conversations });
  // --- End Fix ---
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

  log.debug(`Started processing conversation`, { conversationId, userId });
  // --- FIX: Remove return ---
  res.status(202).json({
    message: 'Processing started',
    conversationId
  });
  // --- End Fix ---
};

// Define routes with middleware
router.post('/', requireAuth, asyncHandler(createNewConversation));
router.get('/:id', requireAuth, requireResourceOwnership({ getResourceById: getConversationById, resourceName: 'Conversation' }), asyncHandler(getConversation));
router.get('/', requireAuth, asyncHandler(getAllConversations));
router.post('/:id/process', requireAuth, requireResourceOwnership({ getResourceById: getConversationById, resourceName: 'Conversation' }), asyncHandler(processConversation));

export default router;