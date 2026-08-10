function getSqsQueueUrl() {
  return (process.env.SQS_QUEUE_URL || "").trim();
}

function getSqsEndpoint() {
  return (process.env.SQS_ENDPOINT || "").trim() || undefined;
}

function getAwsRegion() {
  return process.env.AWS_REGION || "ap-northeast-2";
}

function isSqsEnabled() {
  return Boolean(getSqsQueueUrl());
}

module.exports = {
  getSqsQueueUrl,
  getSqsEndpoint,
  getAwsRegion,
  isSqsEnabled,
};
