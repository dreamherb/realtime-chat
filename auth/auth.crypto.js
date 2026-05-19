const crypto = require("crypto");
const bcrypt = require("bcrypt");

// 이메일 암호화용 AES-256-CBC 설정 (복호화 가능, 결과 일관성 유지)
const EMAIL_ALGO = "aes-256-cbc";
const EMAIL_KEY_HEX = process.env.EMAIL_ENC_KEY; // 32바이트(64 hex) 키 권장

if (!EMAIL_KEY_HEX || Buffer.from(EMAIL_KEY_HEX, "hex").length !== 32) {
  console.warn(
    "[auth.crypto] EMAIL_ENC_KEY 환경 변수가 없거나 32바이트가 아닙니다. 이메일 암호화가 동작하지 않을 수 있습니다.",
  );
}

const EMAIL_KEY = EMAIL_KEY_HEX
  ? Buffer.from(EMAIL_KEY_HEX, "hex")
  : crypto.randomBytes(32); // fallback: 프로세스 생명주기 내 임시 키
const EMAIL_IV = EMAIL_KEY.subarray(0, 16); // 고정 IV (입력값이 같으면 결과 동일)

/**
 * 이메일 양방향 암호화
 * 저장 포맷: cipher(base64)
 */
function encryptEmail(plainEmail) {
  const cipher = crypto.createCipheriv(EMAIL_ALGO, EMAIL_KEY, EMAIL_IV);

  let encrypted = cipher.update(plainEmail, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}

function decryptEmail(encryptedEmail) {
  if (!encryptedEmail) {
    throw new Error("Invalid encrypted email format");
  }

  const decipher = crypto.createDecipheriv(EMAIL_ALGO, EMAIL_KEY, EMAIL_IV);

  let decrypted = decipher.update(encryptedEmail, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// 비밀번호 단방향 해시(bcrypt)
const BCRYPT_SALT_ROUNDS = 10;

async function hashPassword(password) {
  try {
    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    return hashedPassword;
  } catch (error) {
    console.error("ERROR IN HASH PASSWORD : ", error.stack);
    throw error;
  }
}

async function verifyPassword(plainPassword, hashedPassword) {
  try {
    const isPasswordValid = await bcrypt.compare(plainPassword, hashedPassword);
    return isPasswordValid;
  } catch (error) {
    console.error("ERROR IN VERIFY PASSWORD : ", error.stack);
    throw error;
  }
}

module.exports = {
  encryptEmail,
  decryptEmail,
  hashPassword,
  verifyPassword,
};
