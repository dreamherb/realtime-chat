const jwt = require("jsonwebtoken");

const SESSION_COOKIE = "usi";

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

/**
 * 로그인 세션(usi 쿠키)이 없거나 만료되면 루트(로그인)로 리다이렉트
 */
function requireUsiForPage(req, res, next) {
  try {
    const token = getUsiToken(req);
    if (!token) {
      return res.redirect("/");
    }

    req.user = verifyUsiToken(token);
    return next();
  } catch {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return res.redirect("/");
  }
}

function requireAuth(req, res, next) {
  try {
    const cookieToken = getUsiToken(req) || req.cookies?.accessToken;
    const authHeader = req.headers?.authorization || "";
    const bearerToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    const token = cookieToken || bearerToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "인증 토큰이 없습니다.",
      });
    }

    const jwtSecret = process.env.JWT_ACCESS_SECRET;
    if (!jwtSecret) {
      return res.status(500).json({
        success: false,
        message: "JWT 설정이 누락되었습니다.",
      });
    }

    const payload = jwt.verify(token, jwtSecret);
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "유효하지 않은 인증 토큰입니다.",
    });
  }
}

module.exports = {
  SESSION_COOKIE,
  getUsiToken,
  verifyUsiToken,
  requireUsiForPage,
  requireAuth,
};
