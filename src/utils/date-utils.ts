/**
 * Get the start date of the current week (UTC)
 */
export const getCurrentWeekStart = (): number => {
  const now = new Date();
  // Get the day of the week (0-6, where 0 is Sunday)
  const dayOfWeek = now.getUTCDay();
  // Subtract days to get to the start of the week (Sunday)
  const startOfWeek = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - dayOfWeek
  ));
  return Math.floor(startOfWeek.getTime() / 1000);
};

/**
 * Calculate next reset date (start of next week UTC)
 */
export const getNextResetDate = (): number => {
  const now = new Date();
  // Days until next Sunday (if today is Sunday, it's 7)
  const daysUntilNextWeek = 7 - now.getUTCDay();
  const resetDate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + daysUntilNextWeek
  ));
  // Set time to 00:00:00 UTC
  resetDate.setUTCHours(0, 0, 0, 0); 
  return Math.floor(resetDate.getTime() / 1000);
}; 