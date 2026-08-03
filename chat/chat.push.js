const chatService = require("./chat.service");
const notificationsService = require("../notifications/notifications.service");
const { getRedisClient } = require("../infrastructure/redis/redis.client");
const presence = require("../infrastructure/redis/redis.presence");

const PUSH_CONCURRENCY = 5;

/* Promise.all이 길이 5인 배열의 작업이 모두 끝날 떄까지 기다림, 워커는 동시에 5개가 돌아가며
예를 들어 워커 1, 2, 3, 4, 5 가 있고 recipients가 100명일 때
워커 1이 첫번째 수신자에게 푸시 발송, 이때 index는 1이 되고
워커 2가 두번째 수신자에게 푸시 발송, 이때 index는 2가 되는 식,
worker 자체는 비동기로 실행되기에 다섯개의 워커 중 어떤 것이 먼저 끝날지는 모르나
index < items.length로 index값을 체크하여 덜 끝났으면 워커 함수 계속 실행함
*/
async function runWithConcurrency(items, concurrency, fn) {
  if (!items.length) return;
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      await fn(items[current]);
    }
  }
  const workers = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
}

async function resolveOfflineRecipients(candidates, fallbackOfflineIds) {
  const redis = await getRedisClient();
  if (redis) {
    return presence.listOfflineUserIds(candidates);
  }
  if (typeof fallbackOfflineIds === "function") {
    return fallbackOfflineIds(candidates);
  }
  // Redis·소켓 모두 없으면 전원 오프라인으로 보고 푸시 (worker 단독 기동 시)
  return candidates;
}

/**
 * 오프라인 멤버에게만 웹 푸시.
 * Redis presence 우선, 없으면 fallbackOfflineIds(소켓 fetch) 사용.
 */
async function notifyPushForMessage(
  roomId,
  senderId,
  message,
  { fallbackOfflineIds } = {},
) {
  if (!notificationsService.isPushConfigured() || !message) return;

  if (message.type === "SYSTEM_JOIN" || message.type === "SYSTEM_LEAVE") return;

  const preview = chatService.formatMessagePreview(
    message.type,
    message.from,
    message.text,
  );
  if (!preview) return;

  try {
    const memberIds = await chatService.listActiveRoomMemberIds(roomId);
    const candidates = memberIds.filter(
      (memberId) => memberId !== Number(senderId),
    );
    const recipients = await resolveOfflineRecipients(
      candidates,
      fallbackOfflineIds,
    );
    if (!recipients.length) return;

    const title = await chatService.getPushTitleForRoom(roomId, message.from);
    const body = `${message.from}: ${preview}`;
    const payload = {
      title,
      body,
      tag: `chat-${roomId}-msg-${message.id}`,
      url: `/dashboard?roomId=${roomId}`,
    };

    await runWithConcurrency(recipients, PUSH_CONCURRENCY, async (memberId) => {
      const result = await notificationsService.sendPushToUser(
        memberId,
        payload,
      );
      if (process.env.NODE_ENV === "development") {
        console.log("[push] message notify", {
          roomId,
          messageId: message.id,
          memberId,
          result,
        });
      }
    });
  } catch (error) {
    console.error("[push] notifyPushForMessage error:", error.stack);
  }
}

module.exports = {
  notifyPushForMessage,
};
