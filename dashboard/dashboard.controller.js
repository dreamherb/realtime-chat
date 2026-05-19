const dashboardService = require("./dashboard.service");

const dashboardController = {
  async getDashboard(req, res, next) {
    try {
      const encryptedEmail = req.user?.email;
      if (!encryptedEmail) {
        return res.redirect("/");
      }

      const viewData = await dashboardService.getDashboardViewData(encryptedEmail);

      if (!viewData) {
        res.clearCookie("usi", { path: "/" });
        return res.redirect("/");
      }

      return res.render("dashboard", viewData);
    } catch (error) {
      console.error("ERROR IN GET /dashboard : ", error.stack);
      return res.status(500).render("error");
    }
  },
};

module.exports = dashboardController;
