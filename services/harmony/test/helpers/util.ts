/**
 * Partially applies a function by pre-filling some arguments.
 *
 * @param fn - The original function to partially apply.
 * @param presetArgs - Arguments to pre-fill when calling the function.
 *
 * @returns A new function that takes the remaining arguments and calls the original function
 * with both the preset and remaining arguments.
 *
 */
export function partialApply(fn: (...args: unknown[]) => void, ...presetArgs: unknown[]) {
  return (...laterArgs: unknown[]): void => fn(...presetArgs, ...laterArgs);
}