import { query, run, transaction } from "@/database";
import { ValidationError } from "@/middleware/error";
import type { Audio } from "@/types";
import { formatError } from "@/utils/error-formatter";
import { log } from "@/utils/logger";

export const createAudioRecord = async ({
	conversationId,
	userId,
	audioFile,
	audioKey,
}: {
	conversationId: string;
	userId: string;
	audioFile: string;
	audioKey: string;
}): Promise<Audio> => {
	return await transaction(async () => {
		try {
			// Directly attempt to insert the audio record
			const createdAudios = await query<Audio>(
				`INSERT INTO audios (conversationId, userId, audioFile, audioKey, status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'))
         RETURNING *`,
				[conversationId, userId, audioFile, audioKey, "uploaded"],
			);

			const audio = createdAudios[0];

			if (!audio || !audio.id) {
				// This error might indicate a constraint violation that wasn't caught earlier (e.g., DB constraint)
				// or a different insertion issue.
				log.error("Failed to create audio record or retrieve ID after insert", {
					conversationId,
					userId,
					audioKey,
				});
				throw new Error("Failed to create audio record or retrieve ID");
			}

			log.info("Audio record created successfully", {
				audioId: audio.id,
				conversationId,
				userId,
			});
			return audio;
		} catch (error) {
			// Log any error during the transaction (e.g., DB constraint violation, connection issue)
			log.error("Error during createAudioRecord transaction", {
				conversationId,
				audioKey,
				error: formatError(error),
			});
			// Re-throw the caught error to ensure transaction rollback and proper handling upstream
			throw error;
		}
	});
};

export const getAudioById = async (
	audioIdStr: string,
): Promise<Audio | null> => {
	try {
		const audioId = Number.parseInt(audioIdStr, 10);
		if (Number.isNaN(audioId)) {
			log.warn("Invalid numeric ID received for getAudioById", { audioIdStr });
			return null;
		}

		const audios = await query<Audio>("SELECT * FROM audios WHERE id = ?", [
			audioId,
		]);

		const result = audios[0] || null;
		return result;
	} catch (error) {
		log.error("Error fetching audio by ID", {
			audioId: audioIdStr,
			error: formatError(error),
		});
		throw error;
	}
};

export const getConversationAudios = async (
	conversationId: string,
): Promise<Audio[]> => {
	try {
		return await query<Audio>(
			"SELECT * FROM audios WHERE conversationId = ? ORDER BY createdAt ASC",
			[conversationId],
		);
	} catch (error) {
		log.error("Error fetching conversation audios", {
			conversationId,
			error: formatError(error),
		});
		throw error;
	}
};

export const updateAudioStatus = async (
	audioId: number,
	status: string,
	transcription?: string | null,
	errorMessage?: string | null,
): Promise<void> => {
	await transaction(async () => {
		try {
			const audioExistsResult = await query<{ exists_flag: number }>(
				"SELECT 1 as exists_flag FROM audios WHERE id = ? LIMIT 1",
				[audioId],
			);

			const audioExists = audioExistsResult[0]?.exists_flag === 1;

			if (!audioExists) {
				log.warn(
					`Attempted to update status for non-existent audio ID: ${audioId}`,
				);
				throw new Error(`Audio ${audioId} not found`);
			}

			const updateFields = ["status = ?", "updatedAt = strftime('%s', 'now')"];
			const params: unknown[] = [status];

			if (transcription !== undefined) {
				updateFields.push("transcription = ?");
				params.push(transcription);
			}

			if (errorMessage !== undefined) {
				updateFields.push("errorMessage = ?");
				params.push(errorMessage);
			}

			if (status === "transcribed") {
				updateFields.push("audioFile = NULL");
			}

			params.push(audioId);

			await run(
				`UPDATE audios
         SET ${updateFields.join(", ")}
         WHERE id = ?`,
				params,
			);
			log.debug("Audio status updated", { audioId, status });
		} catch (error) {
			log.error("Error updating audio status", {
				audioId,
				status,
				error: formatError(error),
			});
			throw error;
		}
	});
};

export const getAudioByPath = async (
	filePath: string,
): Promise<Audio | null> => {
	try {
		const audios = await query<Audio>(
			"SELECT * FROM audios WHERE audioFile = ?",
			[filePath],
		);
		return audios[0] || null;
	} catch (error) {
		log.error("Failed to get audio by path", {
			filePath,
			error: formatError(error),
		});
		throw error;
	}
};

/**
 * Checks if a new audio record can be created based on constraints.
 * Does NOT insert the record.
 * Throws ValidationError if constraints are violated.
 */
export const checkAudioUploadConstraints = async ({
	conversationId,
	userId,
	audioKey,
}: {
	conversationId: string;
	userId: string;
	audioKey: string;
}): Promise<{ recordingType: string }> => {
	try {
		// Check conversation existence and ownership first
		const conversationResult = await query<{ recordingType: string }>(
			"SELECT recordingType FROM conversations WHERE id = ? AND userId = ? LIMIT 1",
			[conversationId, userId],
		);
		const conversationDetails = conversationResult[0];
		if (!conversationDetails) {
			throw new Error(
				// Or NotFoundError if preferred
				`Conversation ${conversationId} not found or does not belong to user ${userId}`,
			);
		}
		const { recordingType } = conversationDetails;

		// Check existing key and count
		const existingAudios = await query<{
			count: number;
			existingKey: number;
		}>(
			`SELECT
				COUNT(*) as count,
				MAX(CASE WHEN a.audioKey = ? THEN 1 ELSE 0 END) as existingKey
			FROM audios a
			WHERE a.conversationId = ?`,
			[audioKey, conversationId],
		);

		const result = existingAudios[0]; // Should always return a row with count/existingKey (even if 0)
		if (!result) {
			// This case should ideally not happen if the conversation exists
			throw new Error(
				`Failed to query existing audio counts for conversation ${conversationId}`,
			);
		}

		const { count: audioCount, existingKey } = result;

		if (existingKey === 1) {
			throw new ValidationError(
				`Audio with key "${audioKey}" already exists for conversation ${conversationId}`,
			);
		}

		const maxAudios = recordingType === "live" ? 1 : 2; // Simplified: live=1, separate=2
		if (audioCount >= maxAudios) {
			throw new ValidationError(
				`Maximum number of audios (${maxAudios}) reached for ${recordingType} conversation ${conversationId}`,
			);
		}

		// All checks passed
		return { recordingType }; // Return type for potential future use
	} catch (error) {
		// Log specific errors if needed, otherwise re-throw
		log.error("Error checking audio upload constraints", {
			conversationId,
			audioKey,
			userId,
			error: formatError(error),
		});
		// Re-throw ValidationError or other caught errors
		throw error;
	}
};
