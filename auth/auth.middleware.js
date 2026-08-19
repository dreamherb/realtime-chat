const jwt = require("jsonwebtoken");
const {
  DEVICE_COOKIE,
  assertSession,
  revokeByJti,
  readJtiFromToken,
} = require("./auth.sessions");

const SESSION_COOKIE = "usi";

function cookieBase() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
}

function getUsiToken(req) {
  return req.cookies?.[SESSION_COOKIE] || null;
}

function verifyUsiToken(token) {
  const jwtSecret = process.env.JWT_ACCESS_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_ACCESS_SECRET is not configured");
  }
  return jwt.verify(token, jwtSecret);
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

async function attachValidUser(req) {
  const cookieToken = getUsiToken(req) || req.cookies?.accessToken;
  const authHeader = req.headers?.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  const token = cookieToken || bearerToken;
  if (!token) return { ok: false, reason: "MISSING" };

  const payload = verifyUsiToken(token);
  const alive = await assertSession(payload);
  if (!alive) return { ok: false, reason: "REVOKED" };

  return { ok: true, payload, token };
}

/**
 * 로그인 세션(usi 쿠키)이 없거나 만료/철회되면 루트(로그인)로 리다이렉트
 */
async function requireUsiForPage(req, res, next) {
  try {
    const result = await attachValidUser(req);
    if (!result.ok) {
      clearSessionCookie(res);
      return res.redirect("/");
    }
    req.user = result.payload;
    return next();
  } catch {
    clearSessionCookie(res);
    return res.redirect("/");
  }
}

async function requireAuth(req, res, next) {
  try {
    const jwtSecret = process.env.JWT_ACCESS_SECRET;
    if (!jwtSecret) {
      return res.status(500).json({
        success: false,
        message: "JWT 설정이 누락되었습니다.",
      });
    }

    const result = await attachValidUser(req);
    if (!result.ok) {
      return res.status(401).json({
        success: false,
        message:
          result.reason === "MISSING"
            ? "인증 토큰이 없습니다."
            : "유효하지 않은 인증 토큰입니다.",
      });
    }
    req.user = result.payload;
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "유효하지 않은 인증 토큰입니다.",
    });
  }
}

async function revokeRequestSession(req) {
  const token = getUsiToken(req);
  const jti = readJtiFromToken(token);
  if (jti) await revokeByJti(jti);
}

module.exports = {
  SESSION_COOKIE,
  DEVICE_COOKIE,
  cookieBase,
  getUsiToken,
  verifyUsiToken,
  clearSessionCookie,
  attachValidUser,
  requireUsiForPage,
  requireAuth,
  revokeRequestSession,
};
