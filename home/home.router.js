const express = require("express");
const router = express.Router();
const homeController = require("./home.controller");

// 루트 페이지
router.get("/", homeController.getRoot);

module.exports = router;

