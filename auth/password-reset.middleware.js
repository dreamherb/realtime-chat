const {
  PASSWORD_RESET_COOKIE,
  PASSWORD_RESET_COOKIE_PATH,
} = require("./password-reset.constants");
const { verifyPasswordResetJwt } = require("./password-reset.jwt");

function attachPasswordResetClaims(req) {
  const token = req.cookies?.[PASSWORD_RESET_COOKIE];
  if (!token) {
    return null;
  }
  return verifyPasswordResetJwt(token);
}

function requirePasswordResetJwtForPage(req, res, next) {
  try {
    const claims = attachPasswordResetClaims(req);
    if (!claims || !Number.isFinite(claims.userId)) {
      return res.redirect("/auth/forgot?reason=session");
    }
    req.passwordResetClaims = claims;
    return next();
  } catch {
    return res.redirect("/auth/forgot?reason=session");
  }
}

function requirePasswordResetJwtForApi(req, res, next) {
  try {
    const claims = attachPasswordResetClaims(req);
    if (!claims || !Number.isFinite(claims.userId)) {
      return res.status(401).json({
        success: false,
        message: "비밀번호 재설정 권한이 없거나 만료되었습니다. 처음부터 다시 진행해 주세요.",
      });
    }
    req.passwordResetClaims = claims;
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "비밀번호 재설정 권한이 없거나 만료되었습니다.",
    });
  }
}

function clearPasswordResetCookie(res) {
  res.clearCookie(PASSWORD_RESET_COOKIE, {
    path: PASSWORD_RESET_COOKIE_PATH,
  });
}

module.exports = {
  requirePasswordResetJwtForPage,
  requirePasswordResetJwtForApi,
  clearPasswordResetCookie,
};
