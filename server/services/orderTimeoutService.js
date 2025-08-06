const db = require("../config/db");

/**
 * Order Timeout Service - Handles automatic order cancellation after 3 hours
 * This service cancels orders that haven't been paid within the specified time window
 */
class OrderTimeoutService {
  constructor() {
    this.isRunning = false;
    this.timeoutHours = 3; // Cancel orders after 3 hours
  }

  /**
   * Cancel expired orders that haven't been paid within the timeout window
   * @returns {Object} Summary of cancellation process
   */
  async cancelExpiredOrders() {
    if (this.isRunning) {
      console.log("Order timeout service already running.");
      return { status: "skipped", message: "Already running" };
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      console.log(
        `Starting order timeout check. Cancelling orders older than ${this.timeoutHours} hours...`
      );

      // Get orders that are:
      // 1. In pending/processing status with incomplete payment
      // 2. Created more than 3 hours ago
      // 3. Have DragonPay payment initiated (have payment_url)
      const [expiredOrders] = await db.query(
        `
        SELECT 
          o.order_id,
          o.order_code,
          o.order_status,
          o.payment_status,
          o.user_id,
          o.total_price,
          o.created_at,
          p.payment_id,
          p.payment_url,
          p.reference_number,
          p.status as payment_status_detail,
          u.first_name,
          u.last_name,
          u.email,
          TIMESTAMPDIFF(HOUR, o.created_at, NOW()) as hours_since_created
        FROM orders o
        JOIN payments p ON o.order_id = p.order_id
        JOIN users u ON o.user_id = u.user_id
        WHERE o.order_status IN ('pending', 'processing', 'pending_payment')
          AND o.payment_status IN ('pending', 'awaiting_for_confirmation')
          AND p.status IN ('pending', 'waiting_for_confirmation', 'awaiting_for_confirmation')
          AND p.payment_url IS NOT NULL
          AND p.payment_url != ''
          AND TIMESTAMPDIFF(HOUR, o.created_at, NOW()) >= ?
        ORDER BY o.created_at ASC
      `,
        [this.timeoutHours]
      );

      console.log(`Found ${expiredOrders.length} expired orders to cancel.`);

      if (expiredOrders.length === 0) {
        return {
          status: "completed",
          cancelled: 0,
          errors: 0,
          duration: Date.now() - startTime,
          message: "No expired orders found for cancellation",
        };
      }

      let cancelledCount = 0;
      let errorCount = 0;
      const results = [];

      // Process each expired order
      for (const order of expiredOrders) {
        try {
          console.log(
            `Cancelling expired order ${order.order_id} (${order.hours_since_created} hours old)`
          );

          const result = await this.cancelExpiredOrder(order);

          if (result.success) {
            cancelledCount++;
            console.log(`✅ Cancelled order ${order.order_id}`);
          } else {
            errorCount++;
            console.error(
              `❌ Failed to cancel order ${order.order_id}: ${result.error}`
            );
          }

          results.push({
            orderId: order.order_id,
            orderCode: order.order_code,
            hoursExpired: order.hours_since_created,
            success: result.success,
            error: result.error || null,
          });

          // Add small delay between operations
          await this.delay(500);
        } catch (error) {
          console.error(
            `Error processing expired order ${order.order_id}:`,
            error.message
          );
          errorCount++;

          results.push({
            orderId: order.order_id,
            orderCode: order.order_code,
            hoursExpired: order.hours_since_created,
            success: false,
            error: error.message,
          });
        }
      }

      const summary = {
        status: "completed",
        cancelled: cancelledCount,
        errors: errorCount,
        duration: Date.now() - startTime,
        results: results,
      };

      console.log("Order timeout check completed.");
      console.log(
        `Summary: Cancelled: ${cancelledCount}, Errors: ${errorCount}`
      );
      console.log(`Duration: ${summary.duration}ms`);

      return summary;
    } catch (error) {
      console.error("Error in order timeout service:", error);
      return {
        status: "error",
        message: error.message,
        duration: Date.now() - startTime,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Cancel a specific expired order
   * @param {Object} order - Order data from database
   * @returns {Object} Cancellation result
   */
  async cancelExpiredOrder(order) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // Update order status to cancelled
      await connection.query(
        "UPDATE orders SET order_status = ?, payment_status = ?, updated_at = NOW() WHERE order_id = ?",
        ["cancelled", "failed", order.order_id]
      );

      // Update payment status to failed
      await connection.query(
        "UPDATE payments SET status = ?, updated_at = NOW() WHERE order_id = ?",
        ["failed", order.order_id]
      );

      // Restore stock for cancelled order items
      const [orderItems] = await connection.query(
        "SELECT * FROM order_items WHERE order_id = ?",
        [order.order_id]
      );

      for (const item of orderItems) {
        if (item.variant_id) {
          // Restore variant stock
          await connection.query(
            "UPDATE product_variants SET stock = stock + ? WHERE variant_id = ?",
            [item.quantity, item.variant_id]
          );
        } else {
          // Restore product stock
          await connection.query(
            "UPDATE products SET stock = stock + ? WHERE product_id = ?",
            [item.quantity, item.product_id]
          );
        }
      }

      await connection.commit();

      console.log(
        `Order ${order.order_id} cancelled due to payment timeout (${order.hours_since_created} hours)`
      );

      return {
        success: true,
        message: `Order cancelled after ${order.hours_since_created} hours`,
      };
    } catch (error) {
      await connection.rollback();
      console.error(
        `Error cancelling expired order ${order.order_id}:`,
        error.message
      );

      return {
        success: false,
        error: error.message,
      };
    } finally {
      connection.release();
    }
  }

  /**
   * Utility function to add delay
   * @param {number} ms - Milliseconds to wait
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get service status
   * @returns {Object} Current status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      timeoutHours: this.timeoutHours,
      service: "OrderTimeoutService",
    };
  }
}

// Export singleton instance
module.exports = new OrderTimeoutService();
