import { config } from "@/config";
import { gptQueue } from "@/queues";
import {
	getConversationAudios,
	updateAudioStatus,
} from "@/services/audio-service";
import {
	getConversationById,
	updateConversationStatus,
} from "@/services/conversation-service";
import {
	sendAudioNotification,
	sendConversationNotification,
	sendStatusNotification,
} from "@/services/notification-service";
import type { AudioJob } from "@/types";
import { formatError } from "@/utils/error-formatter";
import { deleteFile } from "@/utils/file";
import { log } from "@/utils/logger";
import { transcribeAudio } from "@/utils/openai";
import { type Job, Worker } from "bullmq";
// Helper function to check if all audios for a conversation are transcribed
// and queue for GPT processing if complete.
const _checkConversationCompletionAndQueueGpt = async (
	conversationId: string,
	userId: string,
): Promise<void> => {
	try {
		log.debug("Checking transcription status", { conversationId });
		const [conversation, audios] = await Promise.all([
			getConversationById(conversationId),
			getConversationAudios(conversationId),
		]);

		if (!conversation) {
			throw new Error(
				`Conversation ${conversationId} not found during completion check`,
			);
		}

		const transcribedCount = audios.filter(
			(audio) => audio.status === "transcribed",
		).length;
		const requiredAudios = conversation.recordingType === "separate" ? 2 : 1;

		log.debug("Transcription progress", {
			conversationId,
			transcribedCount,
			requiredAudios,
			recordingType: conversation.recordingType,
		});

		if (transcribedCount === requiredAudios) {
			log.debug("Updating conversation status to processing", {
				conversationId,
			});
			await updateConversationStatus(conversationId, "processing");
			await sendConversationNotification(
				userId,
				conversationId,
				"conversation_started",
			);

			log.debug("Adding conversation to GPT queue", { conversationId });
			await gptQueue.add(
				"process_conversation",
				{ conversationId, userId },
				{
					attempts: 3,
					backoff: { type: "exponential", delay: 5000 },
				},
			);

			log.info("All required audios transcribed, conversation queued for GPT", {
				conversationId,
				transcribedCount,
				requiredAudios,
			});
		}
	} catch (error) {
		// Log error but don't re-throw from helper, main function handles job failure
		log.error("Error during conversation completion check/GPT queueing", {
			conversationId,
			userId,
			error: formatError(error),
		});
		// Consider if specific actions are needed here, e.g., setting conversation to failed?
		// For now, let the main job handler manage the overall audio job status.
	}
};

const cleanupOnFailure = async (audioPath: string, error: unknown): Promise<void> => {
	try {
		// Check if it's a quota error or rate limit error
		const errorMessage = formatError(error);
		const isQuotaError = errorMessage.includes('429') || 
			errorMessage.toLowerCase().includes('quota') ||
			errorMessage.toLowerCase().includes('rate limit');
		
		// Don't delete files on quota errors - we might want to retry later
		if (isQuotaError) {
			log.warn("Skipping file deletion due to quota/rate limit error", { 
				audioPath,
				error: errorMessage 
			});
			return;
		}
		
		await deleteFile(audioPath);
		log.info("Cleaned up audio file after failure", { audioPath });
	} catch (error) {
		log.error("Failed to cleanup audio file", {
			audioPath,
			error: formatError(error),
		});
	}
};

const processAudio = async (job: Job<AudioJob>): Promise<void> => {
	const { audioId, conversationId, audioPath, userId } = job.data;
	const startTime = Date.now();

	log.debug("Audio processing details", {
		jobId: job.id,
		audioId,
		conversationId,
		userId,
		audioPath,
		attemptNumber: job.attemptsMade + 1,
		maxAttempts: job.opts.attempts
	});

	try {
		// Check if file exists before processing
		const fs = await import('fs/promises');
		try {
			await fs.access(audioPath);
		} catch {
			// File doesn't exist - likely deleted in a previous attempt
			const errorMessage = `Audio file not found: ${audioPath}`;
			log.error("Audio file missing", { audioId, audioPath, conversationId });
			
			// Update status and don't retry
			await updateAudioStatus(audioId, "failed", undefined, errorMessage);
			await sendAudioNotification(
				userId,
				audioId.toString(),
				conversationId,
				"failed",
			);
			
			// Don't throw - this prevents retries for missing files
			return;
		}

		// Update audio status to processing
		log.debug("Updating audio status to processing", { audioId });
		await updateAudioStatus(audioId, "processing");
		await sendStatusNotification(userId, conversationId, "processing");

		// Transcribe the audio
		log.debug("Starting transcription", { audioId });
		const transcription = await transcribeAudio(audioPath);
		log.debug("Transcription completed", {
			audioId,
			transcriptionLength: transcription?.length || 0,
		});

		// Update the audio record with transcription and remove audio file path
		log.debug("Updating audio status to transcribed", { audioId });
		await updateAudioStatus(audioId, "transcribed", transcription);
		await sendAudioNotification(
			userId,
			audioId.toString(),
			conversationId,
			"transcribed",
		);

		// Delete the audio file to save space only after successful transcription
		log.debug("Deleting audio file", { audioPath });
		await deleteFile(audioPath);

		// Check if conversation is complete and queue for GPT if necessary
		await _checkConversationCompletionAndQueueGpt(conversationId, userId);

		const totalDuration = Date.now() - startTime;
		log.info("Audio job completed", {
			audioId,
			duration: totalDuration,
			jobId: job.id,
			conversationId,
		});
	} catch (error) {
		const errorMessage = formatError(error);
		const isQuotaError = errorMessage.includes('429') || 
			errorMessage.toLowerCase().includes('quota') ||
			errorMessage.toLowerCase().includes('rate limit');
		
		log.error("Audio processing failed", {
			jobId: job.id,
			error: errorMessage,
			audioId,
			conversationId,
			duration: Date.now() - startTime,
			isQuotaError,
			attemptNumber: job.attemptsMade + 1
		});

		try {
			// For quota errors on last attempt, update with specific message
			if (isQuotaError && job.attemptsMade + 1 >= (job.opts.attempts || 3)) {
				await updateAudioStatus(
					audioId, 
					"failed", 
					undefined, 
					"OpenAI quota exceeded. Please try again later or check your API key quota."
				);
			} else {
				// Update audio status to failed
				log.debug("Updating audio status to failed", { audioId });
				await updateAudioStatus(audioId, "failed", undefined, errorMessage);
			}
			
			await sendAudioNotification(
				userId,
				audioId.toString(),
				conversationId,
				"failed",
			);

			// Cleanup the audio file on failure (with quota check)
			log.debug("Cleaning up audio file after failure", { audioPath });
			await cleanupOnFailure(audioPath, error);
		} catch (updateError) {
			log.error("Failed to update audio status after error", {
				audioId,
				error: formatError(updateError),
			});
		}

		throw error; // Rethrow for BullMQ to handle retries
	}
};

const worker = new Worker<AudioJob>("audioProcessing", processAudio, {
	connection: config.redis,
	concurrency: 3,
});

// Add comprehensive worker event handlers
worker.on("active", (job) =>
	log.info("Audio job started processing", { jobId: job.id }),
);
worker.on("completed", (job) =>
	log.info("Audio job completed successfully", { jobId: job.id }),
);
worker.on("failed", (job, err) =>
	log.error("Audio job failed", { jobId: job?.id, error: err.message }),
);
worker.on("stalled", (jobId) => log.error("Audio job stalled", { jobId }));
worker.on("error", (error) =>
	log.error("Audio worker error", { error: error.message }),
);

export default worker;
