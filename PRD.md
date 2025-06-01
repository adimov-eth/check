Okay, this is the moment to synthesize everything we've discussed – the robust architecture, the detailed legacy insights, and the desired seamless user experience – into a truly comprehensive and ambitious Product Requirements Document (PRD). This document aims to serve not just as a specification but as a blueprint for an elegant, efficient, and expressive application, setting a high standard for quality and user focus.

---

**Product Requirements Document: VibeCheck - The Definitive Conversation Intelligence Platform**

**1. Introduction & Vision**

VibeCheck is poised to redefine how individuals understand and navigate their conversations. By leveraging cutting-edge AI analysis within a seamlessly designed mobile experience, we empower users with objective insights, fostering better communication, understanding, and decision-making.

This document outlines the requirements for the VibeCheck mobile application (iOS & Android) and its supporting backend infrastructure. Our vision extends beyond mere functionality; we aim to craft an application characterized by:

*   **Fluid User Experience:** Interactions feel instantaneous and intuitive, never blocked by background processes. Local-first design ensures responsiveness even offline.
*   **Unshakeable Reliability:** Conversations are captured, uploaded, and processed with exceptional dependability, even amidst network instability. Data integrity is paramount.
*   **Actionable Intelligence:** Analysis is presented clearly and insightfully, providing genuine value and promoting user growth.
*   **Technical Elegance:** The codebase (React Native/Expo client, Bun/Elysia/Prisma backend) will be a model of modern development practices – modular, type-safe, performant, and maintainable, inspiring engineers who contribute to it.

This PRD details the features, flows, and technical underpinnings necessary to achieve this vision, focusing initially on the core recording, analysis, history, and subscription management functionalities.

**2. Goals**

**2.1. User Goals:**

*   **Effortless Capture:** Easily record conversations in various modes (Mediator, Counselor, Dinner, Movie, etc.) using intuitive interfaces ("Separate Steps", "Live Together").
*   **Trustworthy Processing:** Have absolute confidence that recorded audio is securely uploaded and processed reliably, regardless of network conditions or app state.
*   **Timely & Insightful Results:** Receive accurate transcriptions and meaningful AI analysis promptly, with clear status updates throughout the process.
*   **Seamless Interaction:** Experience a smooth, non-blocking interface during recording, upload, and results browsing.
*   **Accessible History:** Easily browse, review, and manage past conversation analyses.
*   **Clear Value Proposition:** Understand subscription tiers and manage subscriptions effortlessly via native platform integrations.

**2.2. Business & Product Goals:**

*   **Establish Core Value:** Deliver a highly reliable and insightful conversation analysis experience that drives user acquisition and retention.
*   **Monetization:** Implement a seamless and compliant subscription model via Apple App Store, clearly communicating value tiers.
*   **Scalable Foundation:** Build a robust, performant, and maintainable architecture capable of supporting future feature expansion and user growth.
*   **Data Integrity:** Ensure successful capture, storage, processing, and delivery of user conversation data with minimal loss.
*   **Brand Reputation:** Foster user trust through reliability, security, and transparent communication regarding data handling and processing status.

**2.3. Technical Goals:**

*   **Performance:** Leverage Bun runtime and ElysiaJS for sub-100ms API response times on average for non-processing endpoints. Ensure client UI remains responsive (<500ms interaction latency). Optimize background tasks for minimal battery/resource impact.
*   **Reliability:** Achieve >99% success rate for client-side upload queueing and >98% E2E success rate for audio uploads reaching final processing completion (assuming eventual network connectivity). Implement robust job queue retries (BullMQ) and idempotent S2S notification handling.
*   **Type Safety:** Enforce end-to-end type safety using TypeScript across client (React Native) and server (ElysiaJS, Prisma), potentially leveraging Elysia Treaty for API client generation.
*   **Maintainability:** Employ a modular architecture (services, routes, workers, hooks, components), clear naming conventions, SOLID principles, and minimal self-documenting code. Utilize Prisma for schema management and type-safe DB access.
*   **Scalability:** Design stateless API instances, horizontally scalable worker processes (Bun), utilize managed PostgreSQL, Redis (cache/queue/pub-sub), and Object Storage for inherent scalability.

**3. Target Audience**

Individuals, couples, friends, or colleagues seeking objective feedback on their communication patterns, tools for resolving disagreements, aids for collaborative decision-making, or simply a deeper understanding of their interactions. Users expect a modern, polished, and reliable mobile application experience.

**4. Core Features & Functional Requirements**

**4.1. Authentication (Sign in with Apple)**

*   **FR-AUTH-1 (Client):** MUST allow users to initiate Sign in with Apple using `expo-apple-authentication`, requesting `FULL_NAME` and `EMAIL` scopes.
*   **FR-AUTH-2 (Client):** Upon successful Apple sign-in, MUST send the `identityToken` in the `Authorization: Bearer <token>` header to the backend authentication endpoint (e.g., `POST /auth/apple`). MUST also send `email` and `fullName` (if provided by Apple) in the request body.
*   **FR-AUTH-3 (API):** MUST expose an endpoint (`/auth/apple`) to receive the client's request.
*   **FR-AUTH-4 (API):** MUST verify the received `identityToken` using `jose`, checking signature against Apple's public keys (fetched from JWKS URL and cached in Redis for ~1 hour), validating `issuer` (`https://appleid.apple.com`), and `audience` (against configured `bundleIdentifier`s). MUST cache verification results (success/failure) in Redis (`RedisCacheService`) with a short TTL (e.g., 5 mins).
*   **FR-AUTH-5 (API):** MUST extract the Apple `sub` (subject ID) and `email` from the verified token.
*   **FR-AUTH-6 (API):** MUST construct an internal `userId` by prefixing the Apple `sub` (e.g., `apple:<SUB_VALUE>`).
*   **FR-AUTH-7 (API):** MUST check if the extracted `email` is already associated with a *different* internal `userId` in the `User` table (Prisma query).
    *   If conflict detected: MUST return a specific error response (`{ success: false, error: "...", code: "EMAIL_ALREADY_EXISTS" }`).
*   **FR-AUTH-8 (API):** If no email conflict, MUST perform a `User` upsert (Prisma `upsert`) using the prefixed `apple:<SUB_VALUE>` as the `id`, storing/updating the `email` and `appAccountToken` (if available from later subscription data). Name should only be stored/updated if provided (usually only on first sign-in).
*   **FR-AUTH-9 (API - Recommended):** Upon successful authentication and user upsert, MUST generate a short-lived session JWT containing the internal `userId` and potentially roles/permissions.
*   **FR-AUTH-10 (API):** MUST return a success response containing the internal `userId` and the session JWT (if implemented) (`{ success: true, data: { user: { id: 'apple:SUB' }, sessionToken?: '...' } }`).
*   **FR-AUTH-11 (Client):** MUST store the received session JWT (preferred) or the original `identityToken` along with the `userId`, `email`, and `fullName` securely using `expo-secure-store`.
*   **FR-AUTH-12 (Client):** MUST include the stored token (session JWT preferred) in the `Authorization: Bearer <token>` header for all subsequent authenticated API requests.
*   **FR-AUTH-13 (Client):** MUST provide a mechanism for the user to sign out, which clears stored tokens (`expo-secure-store`) and navigates to the authentication screen.
*   **FR-AUTH-14 (API):** MUST implement authentication middleware (Elysia plugin) for protected routes, verifying the Bearer token (session JWT preferred, fallback to identity token if needed initially) and attaching the `userId` to the request context.

**4.2. Conversation Management (CRUD & History)**

*   **FR-CONV-1 (API):** MUST expose `POST /conversations` (Auth required):
    *   Accepts `mode` (string, e.g., 'mediator') and `recordingType` (enum: 'separate' | 'live').
    *   Creates a `Conversation` record in PostgreSQL (Prisma) linked to the authenticated `userId`, storing the `mode` and `recordingType`, with initial `status` (e.g., 'pending_upload').
    *   Returns `{ serverId: <new_conversation_id> }`.
*   **FR-CONV-2 (API):** MUST expose `GET /conversations` (Auth required):
    *   Returns a paginated list of conversations belonging to the authenticated user, ordered by `createdAt` (desc).
    *   Includes `id`, `mode`, `recordingType`, `status`, `createdAt`, `updatedAt`. (Exclude results here for performance).
*   **FR-CONV-3 (API):** MUST expose `GET /conversations/:id` (Auth required):
    *   Retrieves a specific `Conversation` record by ID.
    *   MUST verify ownership (conversation `userId` matches authenticated `userId`).
    *   Returns full conversation details, including `status`, `errorMessage`, and potentially pre-computed/cached results (`resultSummary`, `resultAnalysis`) if available.
*   **FR-CONV-4 (API):** MUST expose `DELETE /conversations/:id` (Auth required):
    *   MUST verify ownership.
    *   MUST delete the `Conversation` record (Prisma `delete`). Associated `AudioSegment` records MUST be deleted via `onDelete: Cascade`.
    *   MUST trigger a background job (optional, low priority initially) to delete associated audio files from Object Storage.
    *   Returns `204 No Content` on success.
*   **FR-CONV-5 (Client):** MUST provide a UI to display the list of past conversations (fetched from `GET /conversations`).
*   **FR-CONV-6 (Client):** MUST allow users to tap on a conversation in the list to navigate to its results/details screen (using `GET /conversations/:id`).
*   **FR-CONV-7 (Client):** MUST provide a UI mechanism to initiate deletion of a conversation (calling `DELETE /conversations/:id`).

**4.3. Recording Flow (Local-First)**

*   **FR-REC-1 (Client):** MUST present conversation mode options (Mediator, Counselor, etc.) with descriptions (use `MODE_DESCRIPTIONS`).
*   **FR-REC-2 (Client):** MUST allow selection of `recordingType`: "Separate Steps" (value: 'separate') or "Live Together" (value: 'live').
*   **FR-REC-3 (Client):** Before the *first* recording action for a new session:
    *   MUST check microphone permissions (`expo-av`); prompt if needed. Fail if denied.
    *   MUST call `POST /conversations` API with the selected `mode` and `recordingType` to create the record and get the `serverId`. Store this `serverId` locally (e.g., Zustand state for the active recording flow).
    *   MUST check user's subscription status/usage limits (API call `GET /subscriptions/status` or similar). Prevent recording if limits exceeded, guiding user to upgrade.
*   **FR-REC-4 (Client):** On "Record" tap:
    *   MUST start audio capture using `expo-av`.
    *   MUST clearly indicate recording state in UI (visual indicator, timer).
*   **FR-REC-5 (Client):** On "Stop" tap:
    *   MUST stop audio capture (`expo-av`), obtaining the local file URI.
    *   MUST **immediately** update UI to the next logical state (e.g., "Ready for Partner 2" for 'separate', "Finalizing" for 'live') - Optimistic UI.
    *   MUST determine the correct `audioKey`:
        *   If `recordingType` is 'separate' and this is the first recording: `audioKey` = 'partner1'.
        *   If `recordingType` is 'separate' and this is the second recording: `audioKey` = 'partner2'.
        *   If `recordingType` is 'live': `audioKey` = 'live'.
    *   MUST **immediately** add an upload task to the local persistent queue (Zustand + `expo-file-system` task or reliable storage). Task data MUST include: unique task ID, `localId` (if needed), `serverId`, `audioUri`, `audioKey` (determined above), initial status ('queued'), `attemptCount` (0).
    *   MUST trigger the background upload mechanism to attempt processing the queue.
*   **FR-REC-6 (Client):** MUST handle cancellation: stop recording, discard local URI, cleanup audio session (`expo-av`), reset flow state.

**4.4. Audio Upload & Processing (Reliable Background Execution)**

*   **FR-UPL-1 (Client):** MUST implement a persistent upload queue using reliable storage (e.g., dedicated files managed via `expo-file-system`, potentially moving away from just AsyncStorage for queue state if background task needs direct file access). Zustand can track status but the queue definition needs persistence accessible by the background task.
*   **FR-UPL-2 (Client):** MUST define and register a background task (`expo-task-manager`, potentially triggered by `expo-background-fetch`) responsible for processing the upload queue.
*   **FR-UPL-3 (Client Task):** The background task MUST:
    *   Read the list of queued upload tasks.
    *   For each task:
        *   Attempt to upload the audio file (streamed if possible via `expo-file-system.uploadAsync`) to the backend API (`POST /conversations/:serverId/audio/:audioKey`), including the `serverId` and `audioKey`.
        *   Handle success: Remove task from queue, delete local audio file (`expo-file-system.deleteAsync`). Update global status (Zustand `uploadStatuses`).
        *   Handle failure (network, server error): Implement retry logic (exponential backoff, max attempts). Update task status in queue and global state (Zustand). Mark as permanently failed after max retries. **Do not delete local file on transient failure.**
    *   Task MUST function reliably even if the app is backgrounded or terminated.
*   **FR-UPL-4 (API):** Endpoint `POST /conversations/:serverId/audio/:audioKey` MUST:
    *   Require authentication. Verify user owns the conversation.
    *   Validate the provided `audioKey`. Expected values depend on the `Conversation.recordingType`: 'partner1' or 'partner2' for 'separate', 'live' for 'live'. Reject invalid keys.
    *   Accept streamed audio data (multipart/form-data). **Do not load entire file into memory.**
    *   Stream the audio data directly to configured Object Storage (S3/R2/GCS) using `StorageService`. Generate a unique storage path/key.
    *   On successful upload to Object Storage:
        *   Create/update an `AudioSegment` record (Prisma) linked to the conversation, storing the `audioKey` and `storagePath`. Set initial status (e.g., 'uploaded'). Ensure duplicate `audioKey` submissions for the same conversation are handled gracefully (e.g., overwrite or reject).
        *   Add a `transcription` job to the BullMQ queue (`QueueService`) containing `audioSegmentId`, `storagePath`, `conversationId`, `userId`.
    *   Return `202 Accepted` immediately to the client.
    *   Handle errors gracefully (storage failure, DB failure, invalid key).
*   **FR-UPL-5 (Transcription Worker):** MUST consume `transcription` jobs:
    *   Get `storagePath`, `audioSegmentId`, `userId`, `conversationId`.
    *   Update `AudioSegment` status to 'transcribing' (Prisma). Publish status to Redis Pub/Sub (`conversation_updates`).
    *   Fetch audio stream from Object Storage (`StorageService`).
    *   Call external transcription service (e.g., OpenAI via `transcribeAudio` utility).
    *   On success: Update `AudioSegment` with `transcription` text and status 'transcribed'. Clear `storagePath`? (Or keep for reprocessing?). Delete audio file from Object Storage. Publish status to Redis Pub/Sub. Call `_checkConversationCompletionAndQueueGpt`.
    *   On failure: Update `AudioSegment` status to 'failed', store `errorMessage`. Publish status to Redis Pub/Sub. Implement retries via BullMQ.
    *   **`_checkConversationCompletionAndQueueGpt` (Internal Logic):**
        *   Fetch the `Conversation` record, including its `recordingType`.
        *   Fetch all associated `AudioSegment` records for the `conversationId`.
        *   If `recordingType` is 'live' and *one* segment has status 'transcribed', queue `analysis` job.
        *   If `recordingType` is 'separate' and *two* segments (with keys 'partner1' and 'partner2') have status 'transcribed', queue `analysis` job.
        *   Otherwise, do nothing (wait for other segments or handle partial failures).
*   **FR-UPL-6 (Analysis Worker):** MUST consume `analysis` jobs:
    *   Get `conversationId`, `userId`.
    *   Update `Conversation` status to 'analyzing' (Prisma). Publish status to Redis Pub/Sub.
    *   Fetch conversation details and associated transcriptions (Prisma).
    *   Generate appropriate prompt using `_createGptPrompt` and `SYSTEM_PROMPTS`.
    *   Call external analysis service (e.g., OpenAI via `generateGptResponse`).
    *   On success: Update `Conversation` with results (`resultSummary`, `resultAnalysis`), set status 'complete'. Publish status/results to Redis Pub/Sub. Trigger `push_notification` job.
    *   On failure: Update `Conversation` status to 'failed', store `errorMessage`. Publish status to Redis Pub/Sub. Implement retries via BullMQ.
*   **FR-UPL-7 (Cleanup Worker - Optional):** Periodically scans Object Storage bucket and compares against `AudioSegment` records to identify and potentially delete orphaned audio files.

**4.5. Results Delivery (Real-time & Push)**

*   **FR-RES-1 (API - WebSocket):** MUST implement a WebSocket endpoint (`/ws`).
    *   On connection, MUST require authentication via `{type: 'auth', token: '...'}` message within a timeout (e.g., 10s). Verify token using `AuthService` (leveraging cache). Close connection with specific code (e.g., 4001) on failure.
    *   MUST handle `{type: 'subscribe', topic: 'conversation:<serverId>'}` and `{type: 'unsubscribe', topic: 'conversation:<serverId>'}` messages. Manage client subscriptions efficiently (e.g., in-memory Map keyed by `serverId` or using Redis Pub/Sub capabilities).
    *   MUST subscribe to the internal Redis Pub/Sub channel (`conversation_updates`).
    *   On receiving message from Redis Pub/Sub: Identify relevant `serverId`, find subscribed WebSocket clients, and send appropriately typed messages (e.g., `{type: 'status', payload: { conversationId, status, ...}}`, `{type: 'transcript', payload: {...}}`, `{type: 'analysis', payload: {...}}`, `{type: 'error', payload: {...}}`).
    *   MUST handle client disconnection and cleanup subscriptions. Implement ping/pong or similar for detecting dead connections.
*   **FR-RES-2 (Client - WebSocket):** The Zustand `websocketSlice` MUST:
    *   Attempt connection (`connectWebSocket`) on app start or when needed.
    *   Send `auth` message upon successful connection.
    *   Implement exponential backoff with jitter for reconnections, respecting auth error codes to prevent loops.
    *   Automatically `subscribeToConversation` when user views a specific conversation's results page (if status is pending). Persist subscription requests in `AsyncStorage` and resubscribe upon reconnection.
    *   Automatically `unsubscribeFromConversation` when navigating away.
    *   Process incoming messages, updating the `conversationResults` slice in Zustand with status, transcript, analysis, progress, and errors.
*   **FR-RES-3 (Client - UI):** The Results screen MUST reactively display data from the Zustand `conversationResults` slice, showing loading states, progress, status updates, error messages, and final transcript/analysis content as it becomes available. MUST use `useConversationStatus` hook (or similar) to derive user-friendly status from upload/processing state.
*   **FR-RES-4 (Push Notifications):**
    *   Analysis Worker: MUST enqueue a `push_notification` job upon successful analysis completion.
    *   Notification Worker: MUST consume job. Fetch user's `PushToken` records (Prisma). Use `NotificationService` to send push via FCM/APNS, including `serverId` in data payload.
    *   Client: MUST request notification permissions. MUST register push token with backend (`POST /notifications/register`). MUST handle notification tap -> navigate directly to the correct Results screen using the `serverId` from the payload.

**4.6. Subscription Management (Apple S2S)**

*   **FR-SUB-1 (API):** MUST expose `/webhooks/apple/notifications` endpoint to receive App Store Server Notifications (V2).
*   **FR-SUB-2 (API):** Webhook MUST parse notification, extract `signedPayload`, and verify it using `AppleJwsService`.
*   **FR-SUB-3 (API):** Webhook MUST call `SubscriptionService.processNotification` which:
    *   Finds the internal `userId` via `appAccountToken` (from payload, matched against `User` record) OR fallback to `originalTransactionId` (matched against existing `Subscription` record). Log error if user cannot be mapped.
    *   Performs a Prisma `$transaction` to `upsert` the `Subscription` record using `originalTransactionId` as the primary key. Updates `status`, `expiresDate`, `productId`, etc., based on payload. Uses `determineSubscriptionStatus` logic.
    *   Returns `200 OK` to Apple.
*   **FR-SUB-4 (Client):** MUST use `react-native-iap` (or similar) for initiating purchases and restores.
*   **FR-SUB-5 (Client):** **CRITICAL:** When initiating a purchase, MUST generate a unique UUID and set it as the `appAccountToken` in the purchase parameters for Apple. MUST also store this UUID associated with the user locally *before* purchase and ideally send it to the backend to update the `User` record proactively (or rely on S2S notification payload).
*   **FR-SUB-6 (API):** MUST expose `GET /subscriptions/status` (Auth required). Queries the `Subscription` table (Prisma) using `userId` and current time to determine `isActive`, `expiresDate`, `productId` (`hasActiveSubscription` logic).
*   **FR-SUB-7 (API/Client):** Access to features (e.g., > free tier conversation limit) MUST be gated based on the result of the subscription status check.

**5. Non-Functional Requirements**

*   **NFR-PERF-1:** API endpoints (non-processing) average response time < 150ms.
*   **NFR-PERF-2:** WebSocket message delivery latency (server publish to client receive) < 500ms under normal load.
*   **NFR-PERF-3:** Client UI transitions (e.g., stop recording -> next state) < 300ms.
*   **NFR-PERF-4:** Background upload task CPU/memory usage MUST be minimal to avoid impacting foreground performance or battery life.
*   **NFR-REL-1:** Client upload queue MUST persist across app restarts and survive OS task termination. Background task MUST reliably run.
*   **NFR-REL-2:** Backend job queue (BullMQ) MUST ensure jobs are processed reliably with configured retries. DB operations MUST use transactions for atomicity.
*   **NFR-REL-3:** S2S notification endpoint MUST be idempotent where possible or handle duplicates gracefully.
*   **NFR-SCL-1:** API servers MUST be stateless. Workers MUST be horizontally scalable. Database (PostgreSQL) MUST support connection pooling and scaling reads/writes appropriately. Redis/Object Storage MUST handle load.
*   **NFR-SEC-1:** All communication MUST use HTTPS/WSS. Sensitive data (API keys, secrets) MUST be managed via environment variables/secrets management. Apple JWS signatures MUST be verified. User input MUST be validated/sanitized. Implement rate limiting (use legacy config as baseline). Authorization checks MUST prevent users accessing others' data. Use session JWTs with short expiry.
*   **NFR-MAIN-1:** Code MUST adhere to strict TypeScript, DRY, SOLID principles. CI/CD pipeline MUST enforce linting, formatting (Prettier), and automated tests (`bun:test`, E2E tests).

**6. Data Model & Persistence**

*   **Primary Database:** PostgreSQL managed via Prisma. Schema derived from legacy migrations (User, Subscription, Conversation, AudioSegment, PushToken). Relationships defined with foreign keys and `onDelete: Cascade` where appropriate.
*   **Job Queue:** Redis (managed via BullMQ).
*   **Caching:** Redis (JWKS, verification results).
*   **Audio Files:** Cloud Object Storage (S3/R2/GCS). Path stored in `AudioSegment.storagePath`.
*   **Client Auth Tokens:** `expo-secure-store`.
*   **Client Upload Queue:** `expo-file-system` managed files or reliable storage accessible by background task.
*   **Client WebSocket Subscriptions:** `AsyncStorage` (for persistence across restarts).
*   **Client State:** Zustand (in-memory, with partial persistence via `AsyncStorage` for key slices like non-sensitive settings or offline data).

**7. API Design Philosophy**

*   RESTful principles for synchronous HTTP endpoints (CRUD operations, status checks).
*   WebSocket for real-time, bi-directional communication (status updates, results delivery, client commands like subscribe/unsubscribe).
*   Clear, consistent JSON request/response formats. Use specific error codes (`EMAIL_ALREADY_EXISTS`, standard HTTP status codes mapped via `AppError` classes).
*   Leverage Elysia's type system (and potentially Treaty) for end-to-end type safety.

**8. Architecture Overview**

*   **Client:** React Native (Expo), TypeScript, Zustand, `expo-av`, `expo-file-system`, `expo-task-manager`, `expo-apple-authentication`, `expo-secure-store`.
*   **Backend:** Bun Runtime, ElysiaJS Framework, TypeScript, PostgreSQL, Prisma ORM, Redis (BullMQ Queue, Cache, Pub/Sub), Object Storage SDK, `jose`, OpenAI SDK, FCM/APNS SDKs.
*   **Deployment:** Containerized services (API, Workers) deployable to platforms like Fly.io, Railway, AWS ECS/EKS, etc. Managed PostgreSQL and Redis instances.

**9. Error Handling & Edge Cases**

*   **API:** Global error handler middleware (like legacy `handleError`) catches known `AppError` types and unknown errors, returning consistent JSON responses. Log all errors comprehensively.
*   **Workers:** Implement robust `try...catch` blocks. Utilize BullMQ retry mechanisms. Update record status to 'failed' and store error messages on permanent failure. Handle external API errors gracefully (`ExternalServiceError`).
*   **Client:** Display user-friendly error messages (via Toast, inline errors). Handle API errors (network, server), WebSocket disconnections, permission denials, storage errors, upload failures (provide retry option if applicable), purchase failures.
*   **Edge Cases:** Zero-byte recordings, transcription failures, analysis timeouts, S2S notification delays/duplicates, email conflicts during auth, app kill during upload/recording, running out of storage (client/server).

**10. Security Considerations**

*   Enforce HTTPS/WSS.
*   Securely verify all Apple JWS signatures.
*   Use short-lived session JWTs for API authentication after initial Apple Sign-In.
*   Implement robust input validation (Elysia schemas, sanitization) on API and worker inputs.
*   Protect against path traversal on file operations (legacy `validateFilePath` logic is relevant).
*   Implement API rate limiting per user/IP.
*   Ensure database queries are parameterized (Prisma handles this).
*   Scope all data access by `userId` and implement ownership checks.
*   Securely store all secrets and API keys (env vars, secrets manager).
*   Regularly update dependencies.
*   Perform security audits.

**11. Release Criteria & Success Metrics**

*   **RC1:** All FRs for Authentication, Conversation CRUD, Recording (both types), Upload, Basic Transcription/Analysis (via Workers), Results Delivery (WebSocket/Push), and Subscription Handling (S2S) are implemented and pass E2E testing.
*   **RC2:** NFRs for performance (API response time, UI responsiveness), reliability (upload success rate, job processing), and security are met under simulated load and failure conditions.
*   **RC3:** Application successfully passes review on Apple App Store.
*   **Success Metrics:** User retention rate, number of conversations processed per user, subscription conversion rate, upload success rate (client & server), API error rates, worker job failure rates, average processing time.

**12. Future Considerations / Open Questions**

*   Pause/Resume recording functionality.
*   Support for other authentication providers (Google, Email/Password).
*   More sophisticated analysis models or modes.
*   Sharing conversation results.
*   Web-based client application.
*   Chat — app resolves communication between two devices ( chat with middleman)
*   Detailed analytics and usage reporting.
*   Refining the Object Storage cleanup strategy.
*   Handling potential transcription/analysis costs and implementing finer-grained usage limits.
*   A/B testing different system prompts or analysis models.

---

This PRD provides a detailed roadmap, deeply integrating the chosen architecture and addressing the nuances discovered from the legacy codebase. It sets a high bar for quality, reliability, and user experience, aiming for an application that is both powerful and a pleasure to use and develop.