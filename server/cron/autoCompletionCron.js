const cron = require("node-cron");
const { processAutoCompletions } = require("../controllers/deliveryController");

// Auto-completion cron job - runs every hour
const autoCompletionJob = cron.schedule(
  "0 * * * *",
  async () => {
    try {
      console.log("🕒 Starting scheduled auto-completion check...");
      const result = await processAutoCompletions();
      console.log(
        `✅ Auto-completion check completed: ${result.completed} orders processed`
      );
    } catch (error) {
      console.error("❌ Error in auto-completion cron job:", error);
    }
  },
  {
    scheduled: false, // Don't start immediately
    timezone: "Asia/Manila",
  }
);

// Start the auto-completion job
const startAutoCompletionJob = () => {
  autoCompletionJob.start();
  console.log("🕒 Auto-completion cron job started (runs every hour)");
};

// Stop the auto-completion job
const stopAutoCompletionJob = () => {
  autoCompletionJob.stop();
  console.log("🛑 Auto-completion cron job stopped");
};

module.exports = {
  startAutoCompletionJob,
  stopAutoCompletionJob,
  autoCompletionJob,
};
