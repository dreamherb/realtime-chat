const express = require("express");
const router = express.Router();
const { requireAuth } = require("../auth/auth.middleware");
const dashboardController = require("./dashboard.controller");

router.get("/", requireAuth("page"), dashboardController.getDashboard);

module.exports = router;
