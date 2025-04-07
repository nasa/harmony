/**
 * Sleeps for a duration, checking a condition at 1-second intervals
 * @param duration - Maximum sleep duration in milliseconds
 * @param check - Function that returns true when the sleep should be interrupted
 * @param interval - How often in milliseconds to check the sleep condition
 * @returns Promise that resolves when either the check passes or duration expires
 */
export async function sleepCheck(duration: number, check: () => boolean, interval = 1000): Promise<void> {
  // Calculate the end time
  const endTime = Date.now() + duration;

  // Loop until either the check passes or we exceed the duration
  while (Date.now() < endTime) {
    // Sleep for `interval` msec or the remaining duration, whichever is smaller
    const sleepTime = Math.min(interval, endTime - Date.now());
    await new Promise(resolve => setTimeout(resolve, sleepTime));

    // Check if the condition is true
    if (check()) {
      // Condition passed, exit early
      return;
    }
  }
}