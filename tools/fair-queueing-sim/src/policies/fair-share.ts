//
// Max-min fair shares of a service's pods, shared by the policies that hold users to their fair
// share (adaptive-fast-lane's fix 6 and slot-based-fair-share).
//

/**
 * Computes the max-min fair allocation of a capacity among users with the given demands: every
 * user gets an equal share, except that users who want less than that get what they want and
 * the remainder is shared among the rest.
 *
 * @param demands - each user's demand
 * @param capacity - the total capacity
 * @returns each user's fair share
 */
export function maxMinFairShares(demands: Record<string, number>, capacity: number): Record<string, number> {
  const shares: Record<string, number> = Object.create(null);
  let remaining = capacity;
  let users = Object.keys(demands).filter((u) => demands[u] > 0);
  while (users.length > 0 && remaining > 1e-9) {
    const equal = remaining / users.length;
    const satisfied = users.filter((u) => demands[u] - (shares[u] || 0) <= equal);
    if (satisfied.length === 0) {
      for (const u of users) shares[u] = (shares[u] || 0) + equal;
      remaining = 0;
    } else {
      for (const u of satisfied) {
        remaining -= demands[u] - (shares[u] || 0);
        shares[u] = demands[u];
      }
      users = users.filter((u) => !satisfied.includes(u));
    }
  }
  return shares;
}
