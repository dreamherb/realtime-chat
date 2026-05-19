const crypto = require("crypto");
const { pool } = require("../infrastructure/database");

function hashOtpCode(plainCode) {
  return crypto.createHash("sha256").update(String(plainCode), "utf8").digest("hex");
}

function timingSafeEqualHex(aHex, bHex) {
  try {
    const a = Buffer.from(aHex, "hex");
    const b = Buffer.from(bHex, "hex");
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * OTP 발송 시 사용자당 1행 UPSERT, 이전 reset_jti 무효화
 */
async function upsertOtpForUser({ userId, codeHash, codeExpiresAt }) {
  const sql = `
    INSERT INTO email_auth_number (
      user_id, code_hash, code_expires_at, code_consumed, reset_jti, reset_jti_expires_at
    ) VALUES (?, ?, ?, 0, NULL, NULL)
    ON DUPLICATE KEY UPDATE
      code_hash = VALUES(code_hash),
      code_expires_at = VALUES(code_expires_at),
      code_consumed = 0,
      reset_jti = NULL,
      reset_jti_expires_at = NULL,
      updated_at = NOW()
  `;
  await pool.query(sql, [userId, codeHash, codeExpiresAt]);
}

async function consumeOtpAndSetResetJti({ userId, plainCode, jti, resetJtiExpiresAt }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT code_hash, code_expires_at, code_consumed
       FROM email_auth_number WHERE user_id = ? FOR UPDATE`,
      [userId],
    );
    const row = rows[0];
    if (!row || row.code_consumed === 1) {
      await conn.rollback();
      return { ok: false, reason: "INVALID_CODE" };
    }

    if (new Date(row.code_expires_at) <= new Date()) {
      await conn.rollback();
      return { ok: false, reason: "EXPIRED" };
    }

    if (!timingSafeEqualHex(row.code_hash, hashOtpCode(plainCode))) {
      await conn.rollback();
      return { ok: false, reason: "INVALID_CODE" };
    }

    const [result] = await conn.query(
      `UPDATE email_auth_number
       SET code_consumed = 1,
           reset_jti = ?,
           reset_jti_expires_at = ?,
           updated_at = NOW()
       WHERE user_id = ? AND code_consumed = 0`,
      [jti, resetJtiExpiresAt, userId],
    );

    if (result.affectedRows !== 1) {
      await conn.rollback();
      return { ok: false, reason: "INVALID_CODE" };
    }

    await conn.commit();
    return { ok: true };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * JWT의 userId/jti와 DB의 reset_j티 일치 및 만료 검사 후 비밀번호 변경 및 행 삭제
 */
async function applyNewPasswordAfterResetVerification({
  userId,
  jwtJti,
  passwordHash,
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT reset_jti, reset_jti_expires_at FROM email_auth_number WHERE user_id = ? FOR UPDATE`,
      [userId],
    );
    const row = rows[0];

    if (!row || !row.reset_jti || row.reset_jti !== jwtJti) {
      await conn.rollback();
      return { ok: false, reason: "RESET_TOKEN_INVALID" };
    }

    if (
      !row.reset_jti_expires_at ||
      new Date(row.reset_jti_expires_at) <= new Date()
    ) {
      await conn.rollback();
      return { ok: false, reason: "RESET_TOKEN_EXPIRED" };
    }

    const [upd] = await conn.query(
      "UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?",
      [passwordHash, userId],
    );

    if (upd.affectedRows !== 1) {
      await conn.rollback();
      return { ok: false, reason: "USER_NOT_FOUND" };
    }

    await conn.query("DELETE FROM email_auth_number WHERE user_id = ?", [userId]);
    await conn.commit();
    return { ok: true };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = {
  hashOtpCode,
  upsertOtpForUser,
  consumeOtpAndSetResetJti,
  applyNewPasswordAfterResetVerification,
};
