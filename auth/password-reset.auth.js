const jwt = require("jsonwebtoken");

const PASSWORD_RESET_COOKIE = "passwordReset";
const PASSWORD_RESET_COOKIE_PATH = "/auth/forgot";
const PASSWORD_RESET_JWT_ISSUER = "realtime-chat";
const PASSWORD_RESET_JWT_PURPOSE = "password_reset";
const OTP_TTL_MINUTES = 5;
const RESET_TOKEN_TTL_MINUTES = 5;

function getSecret() {
  const secret = process.env.JWT_PASSWORD_RESET_SECRET;
  if (!secret) {
    throw new Error("JWT_PASSWORD_RESET_SECRET 환경 변수가 필요합니다.");
  }
  return secret;
}

function signPasswordResetJwt({ userId, jti }) {
  return jwt.sign(
    {
      purpose: PASSWORD_RESET_JWT_PURPOSE,
      jti,
    },
    getSecret(),
    {
      subject: String(userId),
      expiresIn: `${RESET_TOKEN_TTL_MINUTES}m`,
      issuer: PASSWORD_RESET_JWT_ISSUER,
      algorithm: "HS256",
    },
  );
}

function verifyPasswordResetJwt(token) {
  const payload = jwt.verify(token, getSecret(), {
    issuer: PASSWORD_RESET_JWT_ISSUER,
    algorithms: ["HS256"],
  });

  if (payload.purpose !== PASSWORD_RESET_JWT_PURPOSE) {
    throw new Error("INVALID_PURPOSE");
  }

  if (!payload.jti) {
    throw new Error("MISSING_JTI");
  }

  return {
    userId: Number(payload.sub),
    jti: payload.jti,
  };
}

function rejectPasswordReset(res, mode) {
  if (mode === "page") {
    return res.redirect("/auth/forgot?reason=session");
  }
  return res.status(401).json({
    success: false,
    message:
      "비밀번호 재설정 권한이 없거나 만료되었습니다. 처음부터 다시 진행해 주세요.",
  });
}

function requirePasswordResetJwt(mode) {
  return (req, res, next) => {
    try {
      const token = req.cookies?.[PASSWORD_RESET_COOKIE];
      const claims = token ? verifyPasswordResetJwt(token) : null;
      if (!claims || !Number.isFinite(claims.userId)) {
        return rejectPasswordReset(res, mode);
      }
      req.passwordResetClaims = claims;
      return next();
    } catch {
      return rejectPasswordReset(res, mode);
    }
  };
}

function clearPasswordResetCookie(res) {
  res.clearCookie(PASSWORD_RESET_COOKIE, {
    path: PASSWORD_RESET_COOKIE_PATH,
  });
}

module.exports = {
  PASSWORD_RESET_COOKIE,
  PASSWORD_RESET_COOKIE_PATH,
  OTP_TTL_MINUTES,
  RESET_TOKEN_TTL_MINUTES,
  signPasswordResetJwt,
  requirePasswordResetJwt,
  clearPasswordResetCookie,
};
