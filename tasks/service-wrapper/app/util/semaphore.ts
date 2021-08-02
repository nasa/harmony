import semaphore from 'semaphore';

// create a semaphore with a concurrency of 1 (a mutex)
const sem = semaphore(1);
export default sem;
