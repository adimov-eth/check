/**
 * Utility for standardizing error handling and formatting error messages
 */

/**
 * Formats any error into a consistent string representation
 * @param error Any error that needs to be formatted
 * @returns Formatted error message
 */
export const formatError = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

/**
 * Creates a context-specific error formatter
 * @param context Context string to prepend to the error message
 * @returns Function that formats error with the provided context
 */
export const createErrorFormatter = (context: string) => {
  return (error: unknown): string => {
    return `${context}: ${formatError(error)}`;
  };
};