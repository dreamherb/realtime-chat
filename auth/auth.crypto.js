const crypto = require("crypto");
const bcrypt = require("bcrypt");

// 암호화용 AES-256-CBC 설정 (복호화 가능, 결과 일관성 유지)
const ENC_ALGO = "aes-256-cbc";
const ENC_KEY_HEX = process.env.ENC_KEY_HEX; // 32바이트(64 hex) 키 권장

if (!ENC_KEY_HEX || Buffer.from(ENC_KEY_HEX, "hex").length !== 32) {
  console.warn(
    "[auth.crypto] ENC_KEY 환경 변수가 없거나 32바이트가 아닙니다. 암호화/복호화가 동작하지 않을 수 있습니다.",
  );
}

const ENC_KEY = ENC_KEY_HEX
  ? Buffer.from(ENC_KEY_HEX, "hex")
  : crypto.randomBytes(32); // fallback: 프로세스 생명주기 내 임시 키
const IV = ENC_KEY.subarray(0, 16); // 고정 IV (입력값이 같으면 결과 동일)

/**
 * 양방향 암호화
 * 저장 포맷: cipher(base64)
 */
function encrypt(plain) {
  const cipher = crypto.createCipheriv(ENC_ALGO, ENC_KEY, IV);

  let encrypted = cipher.update(plain, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}

function decrypt(encrypted) {
  const decipher = crypto.createDecipheriv(ENC_ALGO, ENC_KEY, IV);

  let decrypted = decipher.update(encrypted, "base64", "utf8");
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
  encrypt,
  decrypt,
  hashPassword,
  verifyPassword,
};
