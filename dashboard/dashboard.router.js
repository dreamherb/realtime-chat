const express = require("express");
const router = express.Router();
const { requireUsiForPage } = require("../auth/auth.middleware");
const dashboardController = require("./dashboard.controller");

router.get("/", requireUsiForPage, dashboardController.getDashboard);

module.exports = router;
