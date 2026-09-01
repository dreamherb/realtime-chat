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

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

async function authenticateAccessToken(token) {
  if (!token) return { ok: false, reason: "MISSING" };

  const jwtSecret = process.env.JWT_ACCESS_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_ACCESS_SECRET is not configured");
  }

  const payload = jwt.verify(token, jwtSecret);
  const alive = await assertSession(payload);
  if (!alive) return { ok: false, reason: "REVOKED" };

  return { ok: true, payload, token };
}

async function attachValidUser(req) {
  const cookieToken = getUsiToken(req) || req.cookies?.accessToken;
  const authHeader = req.headers?.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  return authenticateAccessToken(cookieToken || bearerToken);
}

function rejectAuth(res, mode, reason) {
  if (mode === "page") {
    clearSessionCookie(res);
    return res.redirect("/");
  }
  return res.status(401).json({
    success: false,
    message:
      reason === "MISSING"
        ? "인증 토큰이 없습니다."
        : "유효하지 않은 인증 토큰입니다.",
  });
}

function requireAuth(mode) {
  return async (req, res, next) => {
    try {
      if (mode === "api" && !process.env.JWT_ACCESS_SECRET) {
        return res.status(500).json({
          success: false,
          message: "JWT 설정이 누락되었습니다.",
        });
      }

      const result = await attachValidUser(req);
      if (!result.ok) {
        return rejectAuth(res, mode, result.reason);
      }
      req.user = result.payload;
      return next();
    } catch {
      return rejectAuth(res, mode);
    }
  };
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
  clearSessionCookie,
  authenticateAccessToken,
  attachValidUser,
  requireAuth,
  revokeRequestSession,
};
