const cron = require("node-cron");
const orderTimeoutService = require("../services/orderTimeoutService");

/**
 * Order Timeout Cron Job
 * Automatically cancels orders that haven't been paid within 3 hours
 */
class OrderTimeoutCron {
  constructor() {
    this.cronJob = null;
    this.isScheduled = false;
  }

  /**
   * Execute order timeout check
   */
  async executeTimeoutCheck() {
    try {
      console.log("⏰ Running scheduled order timeout check...");
      const result = await orderTimeoutService.cancelExpiredOrders();

      if (result.cancelled > 0) {
        console.log(
          `✅ Order timeout check completed: ${result.cancelled} orders cancelled`
        );
      } else {
        console.log(
          "✅ Order timeout check completed: No expired orders found"
        );
      }

      return result;
    } catch (error) {
      console.error("❌ Error in scheduled order timeout check:", error);
      return { error: error.message };
    }
  }

  /**
   * Start the order timeout cron job
   * Runs every 30 minutes to check for expired orders
   */
  start() {
    if (this.isScheduled) {
      console.log("Order timeout cron job is already scheduled");
      return;
    }

    // Schedule to run every 30 minutes
    // This ensures expired orders are cancelled reasonably quickly
    this.cronJob = cron.schedule(
      "*/30 * * * *",
      async () => {
        await this.executeTimeoutCheck();
      },
      {
        scheduled: false,
        timezone: "Asia/Manila", // Adjust timezone as needed
      }
    );

    this.cronJob.start();
    this.isScheduled = true;

    console.log("Order timeout cron job started");
    console.log("Schedule: Every 30 minutes for automatic order cancellation");
    console.log("Timezone: Asia/Manila");
    console.log("Will cancel orders that are unpaid after 3 hours");
  }

  /**
   * Stop the cron job
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.isScheduled = false;
      console.log("Order timeout cron job stopped");
    }
  }

  /**
   * Get the current status of the cron job
   */
  getStatus() {
    return {
      isScheduled: this.isScheduled,
      isRunning: this.cronJob ? this.cronJob.running : false,
      schedule: "Every 30 minutes",
      timezone: "Asia/Manila",
      description: "Automatically cancels unpaid orders after 3 hours",
    };
  }

  /**
   * Manually trigger a timeout check (for testing or admin use)
   */
  async manualTrigger() {
    console.log("📢 Manual order timeout check triggered");
    return await this.executeTimeoutCheck();
  }
}

// Export singleton instance
module.exports = new OrderTimeoutCron();
