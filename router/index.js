const express = require("express");
const router = express.Router();
const { default: axios } = require("axios");

router.get("/", async function (req, res, next) {
    try {
        return res.render("./login");
    } catch (error) {
        console.error("ERROR IN / GET METHOD : ", error);

        res.status(500).send("An error occurred while getting index.");
        return res.render("./error");
    }
});

module.exports = router;
