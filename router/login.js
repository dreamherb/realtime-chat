const express = require("express");
const router = express.Router();
const {
  encryptEmail,
  hashPassword,
} = require("../utils/crypto");

router.get("/login", async function (req, res, next) {
  try {
    return res.render("login");
  } catch (error) {
    console.error("ERROR IN / GET METHOD : ", error);

    res.status(500).send("An error occurred while getting /auth/login");
    return res.render("error");
  }
});

router.get("/signup", async function (req, res, next) {
  try {
    return res.render("signup");
  } catch (error) {
    console.error("ERROR IN / GET METHOD : ", error);

    res.status(500).send("An error occurred while getting /auth/signup");
    return res.render("error");
  }
});

/**
 * POST /auth/login
 * 로그인 API
 */
router.post("/login", async function (req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "이메일과 비밀번호를 입력해주세요.",
      });
    }

    // TODO: DB에서 사용자 조회 후 비밀번호 검증
    // const user = await findUserByEmail(email);
    // if (!user || !await verifyPassword(password, user.password)) { ... }

    // DB 미구현이므로 요청만 유효하면 성공으로 처리
    // 추후 세션/토큰 발급 로직 추가
    return res.status(200).json({
      success: true,
      message: "로그인되었습니다.",
      redirectUrl: "/dashboard",
    });
  } catch (error) {
    console.error("ERROR IN POST /auth/login : ", error);
    return res.status(500).json({
      success: false,
      message: "로그인 처리 중 오류가 발생했습니다.",
    });
  }
});

/**
 * POST /auth/signup
 * 회원가입 API
 * - 이메일: 복호화 가능한 양방향 암호화
 * - 비밀번호: bcrypt 단방향 해시
 */
router.post("/signup", async function (req, res, next) {
  try {
    const { nickname, email, password, confirmPassword } = req.body || {};

    if (!nickname || !email || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "닉네임, 이메일, 비밀번호를 모두 입력해주세요.",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "비밀번호와 비밀번호 확인이 일치하지 않습니다.",
      });
    }

    const encryptedEmail = encryptEmail(email);
    const passwordHash = await hashPassword(password);

    // TODO: DB에 사용자 정보 저장
    // 예시:
    // await User.create({
    //   nickname,
    //   email: encryptedEmail,
    //   password: passwordHash,
    // });

    console.log("[signup] encryptedEmail:", encryptedEmail);
    console.log("[signup] passwordHash:", passwordHash);

    return res.status(201).json({
      success: true,
      message: "회원가입이 완료되었습니다.",
      redirectUrl: "/auth/login",
    });
  } catch (error) {
    console.error("ERROR IN POST /auth/signup : ", error);
    return res.status(500).json({
      success: false,
      message: "회원가입 처리 중 오류가 발생했습니다.",
    });
  }
});

module.exports = router;
