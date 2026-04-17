// Injectable clock used by verifier scripts so unit tests can run without
// actually sleeping. `now` defaults to Date.now; `sleep` defaults to a real
// setTimeout-based delay. Tests replace both with counters.

export function createClock({
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  return { now, sleep };
}
