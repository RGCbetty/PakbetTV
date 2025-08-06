const cron = require("node-cron");
const axios = require("axios");
const jwt = require("jsonwebtoken");

// Generate an admin token for internal use
const generateAdminToken = () => {
  return jwt.sign({ id: "system", role: "admin" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
};

// Run every day at midnight
const scheduleOrderConfirmation = () => {
  cron.schedule("0 0 * * *", async () => {
    try {
      console.log("Running order auto-completion cron job...");

      const serverUrl = process.env.SERVER_URL || "https://michaeldemesa.com";
      const adminToken = generateAdminToken();

      const response = await axios.post(
        `${serverUrl}/api/orders/auto-complete`,
        {}, // empty body
        {
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("Auto-completion result:", response.data);
    } catch (error) {
      console.error("Error in order auto-completion cron job:", error);
      if (error.response) {
        console.error("Response data:", error.response.data);
        console.error("Response status:", error.response.status);
      }
    }
  });
};

module.exports = { scheduleOrderConfirmation };
