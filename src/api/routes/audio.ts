// src/api/routes/audio.ts
import { requireAuth } from '@/middleware/auth'; // <-- Import requireAuth
import { NotFoundError, ValidationError } from '@/middleware/error';
import { audioRateLimiter } from '@/middleware/rate-limit';
import { audioQueue } from '@/queues';
import {
  createAudioRecord,
  getAudioById,
  getConversationAudios,
  updateAudioStatus
} from '@/services/audio-service';
import { getConversationById } from '@/services/conversation-service';
import type { AuthenticatedRequest } from '@/types/common';
import { asyncHandler } from '@/utils/async-handler'; // <-- Import asyncHandler
import { saveFile } from '@/utils/file';
import { log } from '@/utils/logger';
import type { Request, Response } from 'express';
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
      // Use ValidationError for consistency
      cb(new ValidationError(`Unsupported audio format. Allowed formats: webm, wav, m4a. Received: ${file.mimetype}`));
    }
  },
});

// Validation schemas
const uploadAudioSchema = z.object({
  conversationId: z.string().min(1, 'Conversation ID is required'),
  audioKey: z.string().min(1, 'Audio key is required'), // Added audioKey validation
});

const updateStatusSchema = z.object({
  status: z.enum(['uploaded', 'processing', 'transcribed', 'failed']),
});

// --- Apply Middleware Selectively ---

// Upload new audio file
router.post(
  '/upload',
  requireAuth, // 1. Authenticate first
  audioRateLimiter, // 2. Apply rate limiting
  upload.single('audio'), // 3. Handle file upload
  asyncHandler(async (req: Request, res: Response): Promise<void> => { // Use asyncHandler
    // userId is guaranteed by requireAuth
    const userId = (req as AuthenticatedRequest).userId;

    // Validate request body
    const validationResult = uploadAudioSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError(`Invalid request: ${validationResult.error.errors.map(e => e.message).join(', ')}`);
    }

    const { conversationId, audioKey } = validationResult.data; // Get audioKey

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
    // Include audioKey in the filename for easier identification if needed
    const fileExtension = req.file.originalname.split('.').pop() || req.file.mimetype.split('/')[1] || 'm4a';
    const fileName = `conv_${conversationId}_key_${audioKey}_${Date.now()}.${fileExtension}`;
    const filePath = await saveFile(req.file.buffer, fileName);

    const audio = await createAudioRecord({
      conversationId,
      userId,
      audioFile: filePath,
      audioKey: audioKey // Store the audioKey
    });

    // Queue for processing
    await audioQueue.add(
      'process-audio',
      {
        audioId: audio.id,
        conversationId,
        audioPath: filePath,
        userId,
        audioKey: audioKey // Pass audioKey to the job
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }
      }
    );

    log.debug(`Created audio record and queued for processing`, { audioId: audio.id, conversationId, audioKey });
    // Return minimal success response, client likely tracks via websockets
    res.status(201).json({
        success: true,
        message: "Audio uploaded and queued for processing.",
        audioId: audio.id, // Optionally return ID
        url: filePath // Optionally return server-side path (for debugging?)
    });
  })
);

// Get audio by ID
router.get(
    '/:id',
    requireAuth, // Apply auth
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const userId = (req as AuthenticatedRequest).userId;
        const audioId = Number(req.params.id);

        if (isNaN(audioId)) {
            throw new ValidationError('Invalid audio ID format.');
        }

        const audio = await getAudioById(audioId, userId);
        if (!audio) {
            throw new NotFoundError(`Audio not found: ${audioId}`);
        }

        log.debug(`Retrieved audio`, { audioId, userId });
        res.json({ audio }); // Return the full audio object
    })
);


// Get all audios for a conversation
router.get(
    '/conversation/:conversationId',
    requireAuth, // Apply auth
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const userId = (req as AuthenticatedRequest).userId;
        const { conversationId } = req.params;

        // Verify conversation exists and belongs to user (optional but good practice)
        const conversation = await getConversationById(conversationId, userId);
        if (!conversation) {
            throw new NotFoundError(`Conversation not found: ${conversationId}`);
        }

        const audios = await getConversationAudios(conversationId);
        log.debug(`Retrieved audios for conversation`, { count: audios.length, conversationId, userId });
        res.json({ audios }); // Return the list of audio objects
    })
);


// Update audio status (Potentially for internal use or admin?)
router.patch(
    '/:id/status',
    requireAuth, // Apply auth
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const userId = (req as AuthenticatedRequest).userId;
        const audioId = Number(req.params.id);

        if (isNaN(audioId)) {
            throw new ValidationError('Invalid audio ID format.');
        }

        // Validate request body
        const validationResult = updateStatusSchema.safeParse(req.body);
        if (!validationResult.success) {
            throw new ValidationError(`Invalid status: ${validationResult.error.message}`);
        }

        const { status } = validationResult.data;

        // Verify audio exists and belongs to user before allowing status update
        const audio = await getAudioById(audioId, userId);
        if (!audio) {
            throw new NotFoundError(`Audio not found: ${audioId}`);
        }

        await updateAudioStatus(audio.id, status);
        log.debug(`Updated audio status`, { audioId, status, userId });
        res.json({ success: true });
    })
);


export default router;