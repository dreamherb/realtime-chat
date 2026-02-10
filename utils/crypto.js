const crypto = require("crypto");
const bcrypt = require("bcrypt");

// 이메일 암호화용 AES-256-GCM 설정
const EMAIL_ALGO = "aes-256-gcm";
const EMAIL_KEY_HEX = process.env.EMAIL_ENC_KEY; // 32바이트(64 hex) 키 권장

if (!EMAIL_KEY_HEX || Buffer.from(EMAIL_KEY_HEX, "hex").length !== 32) {
  // 개발 단계에서 키 미설정 시 빠르게 원인 파악할 수 있도록 에러 출력
  console.warn(
    "[crypto util] EMAIL_ENC_KEY 환경 변수가 없거나 32바이트가 아닙니다. 이메일 암호화가 동작하지 않을 수 있습니다."
  );
}

const EMAIL_KEY = EMAIL_KEY_HEX
  ? Buffer.from(EMAIL_KEY_HEX, "hex")
  : crypto.randomBytes(32); // fallback: 프로세스 생명주기 내 임시 키

/**
 * 이메일 양방향 암호화
 * 저장 포맷: iv:tag:cipher (모두 base64)
 */
function encryptEmail(plainEmail) {
  const iv = crypto.randomBytes(12); // GCM 권장 12바이트 IV
  const cipher = crypto.createCipheriv(EMAIL_ALGO, EMAIL_KEY, iv);

  let encrypted = cipher.update(plainEmail, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted,
  ].join(":");
}

function decryptEmail(encryptedEmail) {
  const [ivB64, tagB64, cipherText] = (encryptedEmail || "").split(":");
  if (!ivB64 || !tagB64 || !cipherText) {
    throw new Error("Invalid encrypted email format");
  }

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const decipher = crypto.createDecipheriv(EMAIL_ALGO, EMAIL_KEY, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(cipherText, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// 비밀번호 단방향 해시(bcrypt)
const BCRYPT_SALT_ROUNDS = 10;

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

async function verifyPassword(plainPassword, hashedPassword) {
  return bcrypt.compare(plainPassword, hashedPassword);
}

module.exports = {
  encryptEmail,
  decryptEmail,
  hashPassword,
  verifyPassword,
};

