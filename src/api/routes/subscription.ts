import { getUserId, requireAuth } from "@/middleware/auth";
import { AuthenticationError } from "@/middleware/error";
import { verifyAppleSignedData } from "@/services/apple-jws-verifier";
import {
	hasActiveSubscription,
	updateSubscriptionFromNotification,
	verifyAndSaveSubscription,
} from "@/services/subscription-serivice";
import type { AuthenticatedRequest } from "@/types/common";
import { asyncHandler } from "@/utils/async-handler";
import { formatError } from "@/utils/error-formatter";
import { log } from "@/utils/logger";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";

const router = Router();

router.use((req: Request, res: Response, next: NextFunction) => {
	if (req.path === "/notifications" && req.method === "POST") {
		log.debug("Notifications route hit, bypassing user auth middleware.");
		return next();
	}
	log.debug("Applying auth middleware", { method: req.method, path: req.path });
	requireAuth(req, res, (authError) => {
		if (authError) return next(authError);
		next();
	});
});

const verifySubscriptionSchema = z.object({
	receiptData: z.string(),
});

export const appStoreNotificationSchema = z.object({
	signedPayload: z.string().optional(),
	notificationType: z.string().optional(),
	subtype: z.string().optional().nullable(),
	notificationUUID: z.string().optional(),
	data: z
		.object({
			appAppleId: z.number().optional().nullable(),
			bundleId: z.string().optional().nullable(),
			bundleVersion: z.string().optional().nullable(),
			environment: z.string().optional().nullable(),
			signedTransactionInfo: z.string().optional().nullable(),
			signedRenewalInfo: z.string().optional().nullable(),
		})
		.optional(),
	version: z.string().optional().nullable(),
	signedDate: z.number().optional().nullable(),
});

router.get(
	"/status",
	asyncHandler(async (req: Request, res: Response) => {
		const authReq = req as AuthenticatedRequest;
		const userId = getUserId(authReq);
		if (!userId) {
			throw new AuthenticationError(
				"Unauthorized: No user ID found in /status after auth middleware",
			);
		}

		const subscription = await hasActiveSubscription(userId);
		log.debug("Retrieved subscription status", {
			userId,
			active: subscription.isActive,
		});

		const expiresDateMs = subscription.expiresDate
			? Math.round(subscription.expiresDate)
			: null;

		res.status(200).json({
			subscription: {
				isActive: subscription.isActive,
				expiresDate: expiresDateMs,
				type: subscription.type,
				subscriptionId: subscription.subscriptionId,
			},
		});
	}),
);

router.post(
	"/verify",
	asyncHandler(async (req: Request, res: Response) => {
		const authReq = req as AuthenticatedRequest;
		const userId = getUserId(authReq);
		if (!userId) {
			throw new AuthenticationError(
				"Unauthorized: User ID missing in /verify endpoint.",
			);
		}

		log.info("Subscription verification request received", { userId });

		const validationResult = verifySubscriptionSchema.safeParse(req.body);
		if (!validationResult.success) {
			log.error("Invalid /verify request body", {
				userId,
				error: validationResult.error.message,
			});
			return res
				.status(400)
				.json({
					error: `Invalid request format: ${validationResult.error.message}`,
				});
		}

		const { receiptData } = validationResult.data;

		const verificationResult = await verifyAppleSignedData(receiptData);

		if (!verificationResult.isValid || !verificationResult.payload) {
			log.error("Apple signed data verification failed during /verify", {
				userId,
				error: verificationResult.error || "Unknown reason",
			});
			return res
				.status(400)
				.json({
					error: `Signed data verification failed: ${verificationResult.error}`,
				});
		}

		const payload = verificationResult.payload;
		log.info("Successfully verified signed data for /verify", {
			userId,
			transactionId: payload.transactionId,
			originalTransactionId: payload.originalTransactionId,
		});

		const saveResult = await verifyAndSaveSubscription(userId, payload);

		if (!saveResult.success) {
			log.error("Failed to save subscription from /verify", {
				userId,
				originalTransactionId: payload.originalTransactionId,
				error: formatError(saveResult.error),
			});
			return res
				.status(500)
				.json({ error: "Failed to process subscription verification." });
		}

		const currentStatus = await hasActiveSubscription(userId);
		const expiresDateMs = currentStatus.expiresDate
			? Math.round(currentStatus.expiresDate)
			: null;

		log.info("Successfully processed /verify request", {
			userId,
			originalTransactionId: payload.originalTransactionId,
		});
		res.status(200).json({
			message: "Subscription verified successfully.",
			subscription: {
				isActive: currentStatus.isActive,
				expiresDate: expiresDateMs,
				type: currentStatus.type,
				subscriptionId: currentStatus.subscriptionId,
			},
		});
	}),
);

router.post(
	"/notifications",
	asyncHandler(async (req: Request, res: Response) => {
		log.info("Received App Store notification headers", {
			headers: req.headers,
		});
		log.info("Received App Store notification body (start)", {
			bodyStart: `${JSON.stringify(req.body).substring(0, 300)}...`,
		});

		const validationResult = appStoreNotificationSchema.safeParse(req.body);
		if (!validationResult.success) {
			log.error("Invalid notification format", {
				error: validationResult.error.message,
				body: JSON.stringify(req.body),
			});
			return res
				.status(400)
				.json({
					error: `Invalid notification format: ${validationResult.error.message}`,
				});
		}

		const notification = validationResult.data;

		const signedData =
			notification.signedPayload ||
			notification.data?.signedTransactionInfo ||
			notification.data?.signedRenewalInfo;

		if (!signedData) {
			log.warn("Notification received without signed data", {
				notificationType: notification.notificationType || "Unknown",
			});
			return res
				.status(200)
				.json({
					success: true,
					message: "Notification received but no signed data found to process.",
				});
		}

		log.info("Processing signed data from notification", {
			type: notification.notificationType || "N/A",
			subtype: notification.subtype || "N/A",
			env: notification.data?.environment || "Unknown",
		});

		const verificationResult = await verifyAppleSignedData(signedData);

		if (!verificationResult.isValid || !verificationResult.payload) {
			log.error("App Store signed data verification failed", {
				error: verificationResult.error || "Unknown reason",
				dataStart: `${signedData.substring(0, 100)}...`,
			});
			return res
				.status(500)
				.json({
					error: `Signed data verification failed: ${verificationResult.error}`,
				});
		}

		const payload = verificationResult.payload;
		log.info("Successfully verified signed data from notification", {
			transactionId: payload.transactionId,
			originalTransactionId: payload.originalTransactionId,
			environment: payload.environment,
		});

		const updateResult = await updateSubscriptionFromNotification(payload);

		if (!updateResult.success) {
			log.error("Failed to update subscription from notification", {
				originalTransactionId: payload.originalTransactionId,
				error: formatError(updateResult.error),
			});
			return res
				.status(500)
				.json({
					error: `Failed to process notification: ${formatError(updateResult.error)}`,
				});
		}

		log.info("Successfully processed App Store notification", {
			originalTransactionId: payload.originalTransactionId,
		});
		res.status(200).json({ success: true });
	}),
);

export default router;
