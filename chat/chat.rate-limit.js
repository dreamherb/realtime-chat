const RATE_MAX = 5;
const RATE_WINDOW_MS = 1000;
const BAN_MS = 5000;

/**
 * 유저당 1초에 5회. 초과 시 5초 전송 금지.
 * 프로세스 메모리. ASG면 Redis(userId)로 옮기면 됨.
 */
function consumeSend(state, now = Date.now()) {
  const next = {
    times: Array.isArray(state?.times) ? state.times.slice() : [],
    bannedUntil: Number(state?.bannedUntil) || 0,
  };

  if (now < next.bannedUntil) {
    return {
      ok: false,
      state: next,
      retryAfterMs: next.bannedUntil - now,
    };
  }

  next.times = next.times.filter((t) => now - t < RATE_WINDOW_MS);
  if (next.times.length >= RATE_MAX) {
    next.bannedUntil = now + BAN_MS;
    return { ok: false, state: next, retryAfterMs: BAN_MS };
  }

  next.times.push(now);
  return { ok: true, state: next, retryAfterMs: 0 };
}

module.exports = {
  consumeSend,
  RATE_MAX,
  RATE_WINDOW_MS,
  BAN_MS,
};
