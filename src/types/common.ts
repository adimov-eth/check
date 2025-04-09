/**
 * Common type definitions used across the application
 */

import type { NextFunction, Request, Response } from 'express';

/**
 * Enhanced request object with authenticated user info
 */
export interface AuthenticatedRequest extends Request {
  userId: string;
  email?: string;
  fullName?: {
    givenName?: string;
    familyName?: string;
  };
  resource?: unknown;
}

/**
 * Type for request handler functions
 */
export type RequestHandler = (
  req: Request | AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

/**
 * Type for middleware functions
 */
export type Middleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => void | Promise<void>;

/**
 * Resource access permissions
 */
export enum Permission {
  READ = 'read',
  WRITE = 'write',
  DELETE = 'delete'
}

/**
 * Type for API response structure
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  status?: number;
}

/**
 * Application error codes
 */
export enum ErrorCode {
  AUTHENTICATION = 'authentication_error',
  AUTHORIZATION = 'authorization_error',
  VALIDATION = 'validation_error',
  NOT_FOUND = 'not_found',
  RATE_LIMIT = 'rate_limit',
  SERVER_ERROR = 'server_error',
  EXTERNAL_SERVICE = 'external_service_error'
}

/**
 * Result type for operations that can fail
 */
export type Result<T, E = Error> = 
  | { success: true; data: T }
  | { success: false; error: E; code?: string };