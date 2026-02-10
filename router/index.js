const express = require("express");
const router = express.Router();
const { default: axios } = require("axios");

router.get("/", async function (req, res, next) {
  try {
    // 로그인 처리 안되어있으면 login 페이지로 보내기 기능 필요
    return res.render("login");
  } catch (error) {
    console.error("ERROR IN / GET METHOD : ", error);

    res.status(500).send("An error occurred while getting index.");
    return res.render("error");
  }
});

module.exports = router;
