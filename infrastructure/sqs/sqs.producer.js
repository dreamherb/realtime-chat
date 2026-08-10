const { SendMessageCommand } = require("@aws-sdk/client-sqs");
const { getSqsClient } = require("./sqs.client");
const { getSqsQueueUrl, isSqsEnabled } = require("./sqs.config");

/**
 * 채팅 메시지 생성 이벤트 발행 (SQS).
 * 실패해도 채팅 전송 자체는 이미 성공한 상태이므로 throw 하지 않음.
 */
async function publishChatMessageCreated({ roomId, senderId, message }) {
  if (!isSqsEnabled()) return { ok: false, reason: "SQS_UNAVAILABLE" };

  const client = getSqsClient();
  if (!client) return { ok: false, reason: "SQS_UNAVAILABLE" };

  try {
    await client.send(
      new SendMessageCommand({
        QueueUrl: getSqsQueueUrl(),
        MessageBody: JSON.stringify({
          roomId: Number(roomId),
          senderId: Number(senderId),
          message,
          emittedAt: Date.now(),
        }),
      }),
    );
    return { ok: true };
  } catch (error) {
    console.error("[sqs] publishChatMessageCreated error:", error.message);
    return { ok: false, reason: "PUBLISH_FAILED" };
  }
}

module.exports = {
  publishChatMessageCreated,
};
