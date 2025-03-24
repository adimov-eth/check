import { AuthenticationError, NotFoundError, ValidationError } from '@/middleware/error';
import { audioRateLimiter } from '@/middleware/rate-limit';
import { audioQueue } from '@/queues';
import {
  createAudioRecord,
  getAudioById,
  getConversationAudios,
  updateAudioStatus
} from '@/services/audio-service';
import { getConversationById } from '@/services/conversation-service';
import { saveFile } from '@/utils/file';
import { logger } from '@/utils/logger';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

const router = Router();

// Configure multer for audio uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = [
      'audio/webm',
      'audio/wav',
      'audio/m4a',
      'audio/mp4',
      'audio/x-m4a'
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported audio format. Allowed formats: webm, wav, m4a. Received: ${file.mimetype}`));
    }
  },
});

// Validation schemas
const uploadAudioSchema = z.object({
  conversationId: z.string().min(1, 'Conversation ID is required'),
});

const updateStatusSchema = z.object({
  status: z.enum(['uploaded', 'processing', 'transcribed', 'failed']),
});

// Upload new audio file
router.post(
  '/upload',
  audioRateLimiter,
  upload.single('audio'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.auth?.userId;
      if (!userId) {
        throw new AuthenticationError('Unauthorized: No user ID found');
      }

      // Validate request body
      const validationResult = uploadAudioSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new ValidationError(`Invalid request: ${validationResult.error.message}`);
      }

      const { conversationId } = validationResult.data;

      // Check if conversation exists and belongs to user
      const conversation = await getConversationById(conversationId, userId);
      if (!conversation) {
        throw new NotFoundError(`Conversation not found: ${conversationId}`);
      }

      // Validate file upload
      if (!req.file) {
        throw new ValidationError('No audio file provided');
      }

      // Save file and create record
      const fileName = `audio-${Date.now()}.${req.file.mimetype.split('/')[1]}`;
      const filePath = await saveFile(req.file.buffer, fileName);

      const audio = await createAudioRecord({
        conversationId,
        userId,
        audioFile: filePath
      });

      // Queue for processing
      await audioQueue.add(
        'process-audio',
        {
          audioId: audio.id,
          conversationId,
          audioPath: filePath,
          userId
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 }
        }
      );

      logger.debug(`Created audio record: ${audio.id} for conversation: ${conversationId}`);
      res.status(201).json({ audio });
    } catch (error) {
      next(error);
    }
  }
);

// Get audio by ID
router.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new AuthenticationError('Unauthorized: No user ID found');
    }

    const audio = await getAudioById(Number(req.params.id), userId);
    if (!audio) {
      throw new NotFoundError(`Audio not found: ${req.params.id}`);
    }

    logger.debug(`Retrieved audio: ${req.params.id} for user: ${userId}`);
    res.json({ audio });
  } catch (error) {
    next(error);
  }
});

// Get all audios for a conversation
router.get('/conversation/:conversationId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new AuthenticationError('Unauthorized: No user ID found');
    }

    const { conversationId } = req.params;

    // Verify conversation exists and belongs to user
    const conversation = await getConversationById(conversationId, userId);
    if (!conversation) {
      throw new NotFoundError(`Conversation not found: ${conversationId}`);
    }

    const audios = await getConversationAudios(conversationId);
    logger.debug(`Retrieved ${audios.length} audios for conversation: ${conversationId}`);
    res.json({ audios });
  } catch (error) {
    next(error);
  }
});

// Update audio status
router.patch('/:id/status', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new AuthenticationError('Unauthorized: No user ID found');
    }

    // Validate request body
    const validationResult = updateStatusSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError(`Invalid status: ${validationResult.error.message}`);
    }

    const { status } = validationResult.data;

    // Verify audio exists and belongs to user
    const audio = await getAudioById(Number(req.params.id), userId);
    if (!audio) {
      throw new NotFoundError(`Audio not found: ${req.params.id}`);
    }

    await updateAudioStatus(audio.id, status);
    logger.debug(`Updated audio status: ${req.params.id} to ${status}`);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;