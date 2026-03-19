const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  try {
    const cookieToken = req.cookies?.accessToken;
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
  requireAuth,
};
