const jwt = require("jsonwebtoken");
const {
  PASSWORD_RESET_JWT_ISSUER,
  PASSWORD_RESET_JWT_PURPOSE,
  RESET_TOKEN_TTL_MINUTES,
} = require("./password-reset.constants");

function getSecret() {
  const secret = process.env.JWT_PASSWORD_RESET_SECRET;
  if (!secret) {
    throw new Error("JWT_PASSWORD_RESET_SECRET 환경 변수가 필요합니다.");
  }
  return secret;
}

function signPasswordResetJwt({ userId, jti }) {
  const secret = getSecret();
  const expiresIn = `${RESET_TOKEN_TTL_MINUTES}m`;

  return jwt.sign(
    {
      purpose: PASSWORD_RESET_JWT_PURPOSE,
      jti,
    },
    secret,
    {
      subject: String(userId),
      expiresIn,
      issuer: PASSWORD_RESET_JWT_ISSUER,
      algorithm: "HS256",
    },
  );
}

function verifyPasswordResetJwt(token) {
  const secret = getSecret();
  const payload = jwt.verify(token, secret, {
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

module.exports = {
  signPasswordResetJwt,
  verifyPasswordResetJwt,
};
