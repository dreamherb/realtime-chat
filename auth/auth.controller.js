const {
  SESSION_COOKIE,
  DEVICE_COOKIE,
  cookieBase,
  clearSessionCookie,
  revokeRequestSession,
} = require("./auth.middleware");
const { SESSION_TTL_MS } = require("./auth.sessions");
const authService = require("./auth.service");

const LOGIN_FAIL = {
  MISSING_FIELDS: "이메일과 비밀번호를 입력해주세요.",
  INVALID_CREDENTIALS: "이메일 또는 비밀번호가 일치하지 않습니다.",
};

const SIGNUP_FAIL = {
  MISSING_FIELDS: "닉네임, 이메일, 비밀번호를 모두 입력해주세요.",
  PASSWORD_MISMATCH: "비밀번호와 비밀번호 확인이 일치하지 않습니다.",
  EMAIL_TAKEN: "이미 사용 중인 이메일입니다.",
};

async function postLogin(req, res) {
  try {
    const result = await authService.login({
      email: req.body?.email,
      password: req.body?.password,
      req,
    });

    if (!result.ok) {
      if (result.reason === "JWT_MISSING") {
        return res.status(500).json({
          success: false,
          message: "JWT 설정이 누락되었습니다.",
        });
      }
      return res.status(400).json({
        success: false,
        message: LOGIN_FAIL[result.reason] || "로그인 처리 중 오류가 발생했습니다.",
      });
    }

    res.cookie(SESSION_COOKIE, result.accessToken, {
      ...cookieBase(),
      maxAge: SESSION_TTL_MS,
    });
    res.cookie(DEVICE_COOKIE, result.deviceId, {
      ...cookieBase(),
      maxAge: 365 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      success: true,
      message: "로그인되었습니다.",
      accessToken: result.accessToken,
      redirectUrl: "/dashboard",
    });
  } catch (error) {
    console.error("ERROR IN POST /auth/login : ", error.stack);
    return res.status(500).json({
      success: false,
      message: "로그인 처리 중 오류가 발생했습니다.",
    });
  }
}

async function postSignup(req, res) {
  try {
    const result = await authService.signup(req.body || {});

    if (!result.ok) {
      return res.status(400).json({
        success: false,
        message:
          SIGNUP_FAIL[result.reason] || "회원가입 처리 중 오류가 발생했습니다.",
      });
    }

    return res.status(201).json({
      success: true,
      message: "회원가입이 완료되었습니다.",
      redirectUrl: "/auth/login",
    });
  } catch (error) {
    console.error("ERROR IN POST /auth/signup : ", error.stack);
    return res.status(500).json({
      success: false,
      message: "회원가입 처리 중 오류가 발생했습니다.",
    });
  }
}

async function getLogout(req, res) {
  try {
    await revokeRequestSession(req);
  } catch (error) {
    console.error("ERROR IN GET /auth/logout : ", error.stack);
  }
  clearSessionCookie(res);
  return res.redirect("/auth/login");
}

async function postLogout(req, res) {
  try {
    await revokeRequestSession(req);
    clearSessionCookie(res);
    return res.status(200).json({
      success: true,
      message: "로그아웃되었습니다.",
      redirectUrl: "/",
    });
  } catch (error) {
    console.error("ERROR IN POST /auth/logout : ", error.stack);
    return res.status(500).json({
      success: false,
      message: "로그아웃 처리 중 오류가 발생했습니다.",
    });
  }
}

module.exports = {
  getLogout,
  postLogin,
  postSignup,
  postLogout,
};
