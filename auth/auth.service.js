const jwt = require("jsonwebtoken");
const { pool } = require("../infrastructure/database");
const { encrypt, hashPassword, verifyPassword } = require("./auth.crypto");
const { createSession } = require("./auth.sessions");

async function createUser({ nickname, encryptedEmail, passwordHash }) {
  const sql =
    "INSERT INTO users (nickname, email, password, status, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())";
  const params = [nickname, encryptedEmail, passwordHash, "INACTIVE"];

  try {
    const [result] = await pool.query(sql, params);
    return result;
  } catch (error) {
    if (error?.code !== "ER_DUP_ENTRY") {
      console.error("ERROR IN CREATE USER : ", error.stack);
    }
    throw error;
  }
}

async function findUserByEmail(encryptedEmail) {
  const sql = "SELECT * FROM users WHERE email = ?";
  const params = [encryptedEmail];

  try {
    const [rows] = await pool.query(sql, params);
    return rows[0] || null;
  } catch (error) {
    console.error("ERROR IN FIND USER BY EMAIL : ", error.stack);
    throw error;
  }
}

async function findUserById(userId) {
  const sql = "SELECT * FROM users WHERE id = ?";
  const params = [userId];

  try {
    const [rows] = await pool.query(sql, params);
    return rows[0] || null;
  } catch (error) {
    console.error("ERROR IN FIND USER BY ID : ", error.stack);
    throw error;
  }
}

async function login({ email, password, req }) {
  if (!email || !password) {
    return { ok: false, reason: "MISSING_FIELDS" };
  }

  const encryptedEmail = encrypt(email);
  const user = await findUserByEmail(encryptedEmail);
  if (!user) {
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  const isPasswordValid = await verifyPassword(password, user.password);
  if (!isPasswordValid) {
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  const jwtSecret = process.env.JWT_ACCESS_SECRET;
  if (!jwtSecret) {
    return { ok: false, reason: "JWT_MISSING" };
  }

  const session = await createSession(req, user.id);
  const accessToken = jwt.sign(
    {
      id: user.id,
      email: encryptedEmail,
      nickname: user.nickname,
      sid: session.sessionId,
      plat: session.platform,
    },
    jwtSecret,
    {
      expiresIn: "1h",
      issuer: "realtime-chat",
      jwtid: session.jti,
    },
  );

  return {
    ok: true,
    accessToken,
    deviceId: session.deviceId,
  };
}

async function signup({ nickname, email, password, confirmPassword }) {
  if (!nickname || !email || !password || !confirmPassword) {
    return { ok: false, reason: "MISSING_FIELDS" };
  }

  if (password !== confirmPassword) {
    return { ok: false, reason: "PASSWORD_MISMATCH" };
  }

  try {
    await createUser({
      nickname,
      encryptedEmail: encrypt(email),
      passwordHash: await hashPassword(password),
    });
    return { ok: true };
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return { ok: false, reason: "EMAIL_TAKEN" };
    }
    throw error;
  }
}

module.exports = {
  findUserByEmail,
  findUserById,
  login,
  signup,
};
