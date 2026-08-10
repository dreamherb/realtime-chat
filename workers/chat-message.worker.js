require("dotenv").config({
  path: `./.env.${process.env.NODE_ENV || "development"}`,
});

const {
  ReceiveMessageCommand,
  DeleteMessageCommand,
} = require("@aws-sdk/client-sqs");
const { getSqsClient } = require("../infrastructure/sqs/sqs.client");
const {
  getSqsQueueUrl,
  isSqsEnabled,
} = require("../infrastructure/sqs/sqs.config");
const { notifyPushForMessage } = require("../chat/chat.push");

// --- Kafka worker (보관: 재전환 시 아래 SQS 루프 대신 사용) ---
// const { getKafka } = require("../infrastructure/kafka/kafka.client");
// const {
//   TOPICS,
//   isKafkaEnabled,
//   getKafkaGroupId,
// } = require("../infrastructure/kafka/kafka.config");
//
// async function startKafka() {
//   if (!isKafkaEnabled()) {
//     console.error("[worker] KAFKA_BROKERS 미설정. worker를 종료합니다.");
//     process.exit(1);
//   }
//
//   const kafka = getKafka();
//   const consumer = kafka.consumer({ groupId: getKafkaGroupId() });
//
//   await consumer.connect();
//   await consumer.subscribe({
//     topic: TOPICS.CHAT_MESSAGE_CREATED,
//     fromBeginning: false,
//   });
//
//   console.log(
//     `[worker] listening topic=${TOPICS.CHAT_MESSAGE_CREATED} group=${getKafkaGroupId()}`,
//   );
//
//   await consumer.run({
//     eachMessage: async ({ message }) => {
//       if (!message.value) return;
//
//       let event;
//       try {
//         event = JSON.parse(message.value.toString());
//       } catch (error) {
//         console.error("[worker] invalid json:", error.message);
//         return;
//       }
//
//       const { roomId, senderId, message: chatMessage } = event;
//       if (!roomId || !senderId || !chatMessage) return;
//
//       await notifyPushForMessage(roomId, senderId, chatMessage);
//     },
//   });
// }

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

async function start() {
  if (!isSqsEnabled()) {
    console.error("[worker] SQS_QUEUE_URL 미설정. worker를 종료합니다.");
    process.exit(1);
  }

  const client = getSqsClient();
  const queueUrl = getSqsQueueUrl();

  console.log(`[worker] listening queue=${queueUrl}`);

  while (true) {
    let res;
    try {
      res = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          VisibilityTimeout: 30,
        }),
      );
    } catch (error) {
      console.error("[worker] receive error:", error.message);
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    const messages = res.Messages || [];
    for (const msg of messages) {
      try {
        await handleMessage(msg.Body);
        await client.send(
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
}

start().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
