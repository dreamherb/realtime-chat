require("dotenv").config({
  path: `./.env.${process.env.NODE_ENV || "development"}`,
});

const {
  ReceiveMessageCommand,
  DeleteMessageCommand,
} = require("@aws-sdk/client-sqs");
const { getSqsClient, getSqsQueueUrl, isSqsEnabled } = require("../infrastructure/sqs/sqs.client");
const { pool } = require("../infrastructure/database");
const { closeRedis } = require("../infrastructure/redis/redis.client");
const { notifyPushForMessage } = require("../chat/chat.push");

async function handleMessage(body) {
  let event;
  try {
    event = JSON.parse(body);
  } catch (error) {
    console.error("[worker] invalid json:", error.message);
    return false;
  }

  const { roomId, senderId, message: chatMessage } = event;
  if (!roomId || !senderId || !chatMessage) return false;

  // 이유: 메시지 전송 경로에서 푸시 HTTP를 분리해 채팅 latency/부하 보호
  await notifyPushForMessage(roomId, senderId, chatMessage);
  return true;
}

const SHUTDOWN_MS = 15000;
let stopping = false;
let sqsClient = null;

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] shutdown ${signal}`);
  if (sqsClient) sqsClient.destroy();

  const timer = setTimeout(() => {
    console.error("[worker] shutdown timeout");
    process.exit(1);
  }, SHUTDOWN_MS);
  timer.unref();
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});

async function start() {
  if (!isSqsEnabled()) {
    console.error("[worker] SQS_QUEUE_URL 미설정. worker를 종료합니다.");
    process.exit(1);
  }

  sqsClient = getSqsClient();
  const queueUrl = getSqsQueueUrl();

  console.log(`[worker] listening queue=${queueUrl}`);

  while (!stopping) {
    let res;
    try {
      res = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          VisibilityTimeout: 30,
        }),
      );
    } catch (error) {
      if (stopping) break;
      console.error("[worker] receive error:", error.message);
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    const messages = res.Messages || [];
    for (const msg of messages) {
      if (stopping) break;
      try {
        await handleMessage(msg.Body);
        await sqsClient.send(
          new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: msg.ReceiptHandle,
          }),
        );
      } catch (error) {
        console.error("[worker] handle error:", error.message);
        // 삭제하지 않음 → VisibilityTimeout 후 재전달
      }
    }
  }

  await closeRedis();
  await pool.end();
}

start().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
