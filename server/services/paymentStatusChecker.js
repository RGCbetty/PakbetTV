const db = require("../config/db");
const dragonpayService = require("./dragonpayService");
const deliveryRouter = require("../routes/delivery");
const { sendOrderConfirmationEmail } = require("./emailService");

class PaymentStatusChecker {
  constructor() {
    this.isRunning = false;
    this.processedTransactions = new Set(); // Track processed transactions to avoid duplicates
    this.retryQueue = new Map(); // Track failed payments for retry
    this.maxRetries = 3;
  }

  /**
   * Check payment status for all pending orders using Dragonpay Transaction Status Query API
   * @returns {Object} Summary of the checking process
   */
  async checkPendingPayments() {
    if (this.isRunning) {
      console.log("Payment status check already running.");
      return { status: "skipped", message: "Already running" };
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      console.log("Starting Dragonpay status check.");

      // Get all orders with payment awaiting confirmation that have reference numbers
      const [pendingOrders] = await db.query(`
        SELECT 
          o.order_id, 
          o.order_code, 
          o.order_status, 
          o.payment_status,
          o.user_id,
          o.total_price,
          o.created_at as order_created,
          p.payment_id,
          p.reference_number,
          p.status as payment_status_detail,
          p.created_at as payment_created,
          p.transaction_id,
          u.first_name,
          u.last_name,
          u.email
        FROM orders o
        JOIN payments p ON o.order_id = p.order_id
        JOIN users u ON o.user_id = u.user_id
        WHERE o.payment_status IN ('awaiting_for_confirmation', 'pending')
          AND p.reference_number IS NOT NULL
          AND p.reference_number != ''
          AND p.status IN ('waiting_for_confirmation', 'pending')
          AND p.created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
        ORDER BY p.created_at DESC
      `);

      console.log(`Found ${pendingOrders.length} pending Dragonpay payments.`);

      if (pendingOrders.length === 0) {
        return {
          status: "completed",
          checked: 0,
          updated: 0,
          errors: 0,
          duration: Date.now() - startTime,
          message: "No pending payments found for verification",
        };
      }

      let checkedCount = 0;
      let updatedCount = 0;
      let errorCount = 0;
      let skippedCount = 0;
      const results = [];

      // Process each pending order using Dragonpay Transaction Status Query API
      for (const order of pendingOrders) {
        try {
          // Skip if we already processed this transaction in this run
          if (this.processedTransactions.has(order.reference_number)) {
            console.log(`Skipping transaction: ${order.reference_number}`);
            skippedCount++;
            continue;
          }

          console.log(`Querying Dragonpay for order ${order.order_id}.`);

          // Query Dragonpay Transaction Status API
          const inquiryResult = await dragonpayService.inquireTransaction(
            order.reference_number
          );
          checkedCount++;

          // Track this transaction as processed
          this.processedTransactions.add(order.reference_number);

          const result = {
            orderId: order.order_id,
            orderCode: order.order_code,
            referenceNumber: order.reference_number,
            previousStatus: order.payment_status,
            previousPaymentStatus: order.payment_status_detail,
            dragonpayStatus: inquiryResult.status,
            dragonpayMessage: inquiryResult.message,
            success: inquiryResult.success,
            updated: false,
            action: "none",
          };

          // Check if status has changed and needs updating
          const shouldUpdate = this.shouldUpdateOrderStatus(
            order,
            inquiryResult
          );

          if (shouldUpdate) {
            console.log(
              `Updating order ${order.order_id} to status: ${inquiryResult.status}`
            );
            await this.updateOrderPaymentStatus(order, inquiryResult);
            result.updated = true;
            result.newStatus = dragonpayService.mapStatusToOrderPaymentStatus(
              inquiryResult.status
            );
            result.newOrderStatus = dragonpayService.mapStatusToOrderStatus(
              inquiryResult.status
            );
            result.action =
              inquiryResult.status.toUpperCase() === "S"
                ? "complete_transaction"
                : "update_status";
            updatedCount++;

            console.log(
              `Updated order ${order.order_id}: ${inquiryResult.status}`
            );
          } else {
            console.log(`No update needed for order ${order.order_id}.`);
          }

          results.push(result);

          // Add a small delay between requests to be respectful to Dragonpay API
          await this.delay(1000);
        } catch (error) {
          console.error(
            `Error checking Dragonpay status for order ${order.order_id}:`,
            error.message
          );
          errorCount++;

          // Add to retry queue if not already there
          const retryKey = `${order.order_id}-${order.reference_number}`;
          const currentRetries = this.retryQueue.get(retryKey) || 0;

          if (currentRetries < this.maxRetries) {
            this.retryQueue.set(retryKey, currentRetries + 1);
            console.log(
              `Added order ${order.order_id} to retry queue (${
                currentRetries + 1
              }/${this.maxRetries})`
            );
          }

          results.push({
            orderId: order.order_id,
            orderCode: order.order_code,
            referenceNumber: order.reference_number,
            error: error.message,
            retryCount: currentRetries,
            updated: false,
          });
        }
      }

      // Process retry queue
      if (this.retryQueue.size > 0) {
        console.log(`Processing ${this.retryQueue.size} retry items.`);
        await this.processRetryQueue();
      }

      const summary = {
        status: "completed",
        checked: checkedCount,
        updated: updatedCount,
        errors: errorCount,
        skipped: skippedCount,
        retries: this.retryQueue.size,
        duration: Date.now() - startTime,
        results: results,
      };

      console.log("Dragonpay status check completed.");
      console.log(
        `Summary: Checked: ${checkedCount}, Updated: ${updatedCount}, Errors: ${errorCount}, Skipped: ${skippedCount}`
      );
      console.log(`Duration: ${summary.duration}ms`);

      return summary;
    } catch (error) {
      console.error("Error in Dragonpay payment status checker:", error);
      return {
        status: "error",
        message: error.message,
        duration: Date.now() - startTime,
      };
    } finally {
      this.isRunning = false;
      // Clear processed transactions after a delay
      setTimeout(() => {
        this.processedTransactions.clear();
      }, 300000); // Clear after 5 minutes
    }
  }

  /**
   * Process retry queue for failed payment checks
   */
  async processRetryQueue() {
    const retryEntries = Array.from(this.retryQueue.entries());

    for (const [retryKey, retryCount] of retryEntries) {
      const [orderId, referenceNumber] = retryKey.split("-");

      try {
        console.log(
          `Retrying Dragonpay check for order ${orderId} (attempt ${retryCount}/${this.maxRetries})`
        );

        // Get order details again
        const [orders] = await db.query(
          `
          SELECT o.*, p.*, u.first_name, u.last_name, u.email
          FROM orders o
          JOIN payments p ON o.order_id = p.order_id
          JOIN users u ON o.user_id = u.user_id
          WHERE o.order_id = ? AND p.reference_number = ?
        `,
          [orderId, referenceNumber]
        );

        if (orders.length > 0) {
          const order = orders[0];
          const inquiryResult = await dragonpayService.inquireTransaction(
            referenceNumber
          );

          if (this.shouldUpdateOrderStatus(order, inquiryResult)) {
            await this.updateOrderPaymentStatus(order, inquiryResult);
            console.log(
              `Retry successful for order ${orderId}: ${inquiryResult.status}`
            );
          }

          // Remove from retry queue on success
          this.retryQueue.delete(retryKey);
        }

        await this.delay(2000); // Longer delay for retries
      } catch (error) {
        console.error(`Retry failed for order ${orderId}:`, error.message);

        if (retryCount >= this.maxRetries) {
          console.log(
            `Max retries reached for order ${orderId}, removing from queue`
          );
          this.retryQueue.delete(retryKey);
        }
      }
    }
  }

  /**
   * Determine if order status should be updated based on Dragonpay response
   * @param {Object} order - Order data from database
   * @param {Object} inquiryResult - Result from Dragonpay Transaction Status Query
   * @returns {boolean} Whether to update the order
   */
  shouldUpdateOrderStatus(order, inquiryResult) {
    const currentPaymentStatus = order.payment_status;
    const dragonpayStatus = inquiryResult.status?.toUpperCase();

    // Always update if Dragonpay status is success (S) or failure (F)
    if (dragonpayStatus === "S" || dragonpayStatus === "F") {
      return true;
    }

    // Update if status changed from pending to something else
    if (dragonpayStatus && dragonpayStatus !== "P" && dragonpayStatus !== "U") {
      return true;
    }

    // Check for timeout - mark as failed after extended period
    const daysSincePayment =
      (Date.now() - new Date(order.payment_created).getTime()) /
      (1000 * 60 * 60 * 24);

    // After 7 days, consider unknown/pending as expired
    if (daysSincePayment > 7 && ["U", "P"].includes(dragonpayStatus)) {
      console.log(
        `Payment for order ${
          order.order_id
        } has been pending for ${daysSincePayment.toFixed(
          1
        )} days, marking as expired`
      );
      return true;
    }

    return false;
  }

  /**
   * Update order status based on Dragonpay Transaction Status Query result
   * Executes complete transaction flow including waybill generation when payment is successful
   * @param {Object} order - Order data from database
   * @param {Object} inquiryResult - Result from Dragonpay Transaction Status Query
   */
  async updateOrderPaymentStatus(order, inquiryResult) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const dragonpayStatus = inquiryResult.status?.toUpperCase();
      const orderStatus =
        dragonpayService.mapStatusToOrderStatus(dragonpayStatus);
      const paymentStatus =
        dragonpayService.mapStatusToOrderPaymentStatus(dragonpayStatus);
      const internalPaymentStatus =
        dragonpayService.mapStatusToInternal(dragonpayStatus);

      console.log(
        `Updating order ${order.order_id} based on Dragonpay status: ${dragonpayStatus}`
      );
      console.log(`Order status: ${order.order_status} -> ${orderStatus}`);
      console.log(
        `Payment status: ${order.payment_status} -> ${paymentStatus}`
      );

      // Update orders table
      await connection.query(
        "UPDATE orders SET order_status = ?, payment_status = ?, updated_at = NOW() WHERE order_id = ?",
        [orderStatus, paymentStatus, order.order_id]
      );

      // Update payments table with transaction details
      await connection.query(
        "UPDATE payments SET status = ?, transaction_id = ?, updated_at = NOW() WHERE payment_id = ?",
        [
          internalPaymentStatus,
          inquiryResult.txnId || order.reference_number,
          order.payment_id,
        ]
      );

      // If payment is successful (S), execute complete transaction flow
      if (dragonpayStatus === "S") {
        console.log(`Payment successful for order ${order.order_id}`);

        try {
          // 1. Empty the user's cart
          await connection.query("DELETE FROM cart WHERE user_id = ?", [
            order.user_id,
          ]);
          console.log(`Cart cleared for user ${order.user_id}`);

          // Commit the payment status changes first
          await connection.commit();

          // 2. Create shipping order and generate waybill (external API - separate from transaction)
          console.log(`🚚 Creating shipping order for order ${order.order_id}`);
          try {
            const shippingResult = await deliveryRouter.createShippingOrder(
              order.order_id
            );
            console.log(
              `Shipping order created successfully for order ${order.order_id}:`,
              {
                tracking_number: shippingResult?.tracking_number,
                status: shippingResult?.status,
              }
            );

            if (shippingResult && shippingResult.tracking_number) {
              // Update with tracking number
              await db.query(
                "UPDATE orders SET tracking_number = ? WHERE order_id = ?",
                [shippingResult.tracking_number, order.order_id]
              );
              console.log(
                `Tracking number assigned: ${shippingResult.tracking_number}`
              );
              console.log(`Waybill ready: ${shippingResult.tracking_number}`);
            } else {
              console.warn(
                `⚠️ Shipping order created but no tracking number returned for order ${order.order_id}`
              );
            }
          } catch (shippingError) {
            console.error(
              `❌ Failed to create shipping order for order ${order.order_id}:`,
              shippingError.message
            );
            if (shippingError.response) {
              console.error(`📋 Shipping API Error Details:`, {
                status: shippingError.response.status,
                statusText: shippingError.response.statusText,
                data: shippingError.response.data,
              });
            }
            // Don't throw the error, continue with email sending
          }

          // 3. Send order confirmation email with all details
          console.log(
            `Sending order confirmation email for order ${order.order_id}`
          );
          await this.sendConfirmationEmail(
            order,
            shippingResult?.tracking_number
          );

          // 4. Log completion
          console.log(`Transaction flow complete for order ${order.order_id}`);
          console.log(`Payment confirmed and recorded`);
          console.log(`Cart cleared`);
          console.log(
            `Shipping order created${
              shippingResult?.tracking_number
                ? ` (${shippingResult.tracking_number})`
                : ""
            }`
          );
          console.log(`Confirmation email sent`);
          console.log(`Waybill ready for generation`);
        } catch (transactionFlowError) {
          console.error(
            "Transaction flow error:",
            transactionFlowError.message
          );
          // Payment update was successful, but note the shipping/email failure
          console.log("Payment confirmed, some post-processing failed");
        }
      }
      // For failed payments (F), mark as cancelled
      else if (dragonpayStatus === "F") {
        console.log(`Payment failed for order ${order.order_id}`);
        await connection.commit();
      }
      // For other statuses (pending, unknown, etc.), just update status
      else {
        console.log(
          `Payment status updated for order ${order.order_id}: ${dragonpayStatus}`
        );
        await connection.commit();
      }

      console.log(
        `Order ${order.order_id} updated: ${orderStatus}/${paymentStatus}`
      );
    } catch (error) {
      await connection.rollback();
      console.error(
        `DB error updating order ${order.order_id}:`,
        error.message
      );
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Send order confirmation email
   * @param {Object} order - Order data
   * @param {string} trackingNumber - Tracking number if available
   */
  async sendConfirmationEmail(order, trackingNumber = null) {
    try {
      // Get order items
      const [orderItems] = await db.query(
        "SELECT oi.*, p.name FROM order_items oi " +
          "JOIN products p ON oi.product_id = p.product_id " +
          "WHERE oi.order_id = ?",
        [order.order_id]
      );

      // Get shipping address - prioritize shipping table (actual checkout data)
      const [shippingInfo] = await db.query(
        "SELECT * FROM shipping WHERE order_id = ?",
        [order.order_id]
      );

      const [userShippingDetails] = await db.query(
        "SELECT * FROM user_shipping_details WHERE user_id = ? AND is_default = 1",
        [order.user_id]
      );

      // Use shipping table data if available, fallback to user data
      const customerName =
        shippingInfo[0]?.name || `${order.first_name} ${order.last_name}`;
      const customerEmail = shippingInfo[0]?.email || order.email;
      const customerPhone = shippingInfo[0]?.phone || order.phone || "N/A";

      // Build complete address
      let fullAddress = "Address not available";
      if (shippingInfo.length > 0) {
        fullAddress = shippingInfo[0].address;
      } else if (userShippingDetails.length > 0) {
        const addr = userShippingDetails[0];

        // Use detailed address fields if available (newer format)
        if (addr.house_number || addr.building || addr.street_name) {
          const detailedAddressParts = [
            addr.house_number,
            addr.building,
            addr.street_name,
            addr.barangay,
            addr.city_municipality,
            addr.province,
            addr.postcode,
            addr.country,
          ].filter((part) => part && part.trim() !== "" && part !== "null");

          fullAddress = detailedAddressParts.join(", ");
        } else {
          // Fallback to basic address fields
          const addressParts = [
            addr.address1,
            addr.address2,
            addr.city,
            addr.state || addr.province,
            addr.postcode,
            addr.country,
          ].filter((part) => part && part.trim() !== "" && part !== "null");

          fullAddress = addressParts.join(", ");
        }
      }

      const emailDetails = {
        orderNumber: order.order_code || order.order_id,
        customerName: customerName,
        customerEmail: customerEmail,
        customerPhone: customerPhone,
        items: orderItems.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          price: parseFloat(item.price),
        })),
        totalAmount: parseFloat(order.total_price),
        shippingFee: 50, // Standard shipping fee - you can make this dynamic
        discount: 0,
        shippingAddress: fullAddress,
        paymentMethod: "DragonPay",
        paymentReference: order.reference_number,
        trackingNumber: trackingNumber,
      };

      await sendOrderConfirmationEmail(emailDetails);
      console.log(`Confirmation email sent for order ${order.order_id}`);
    } catch (emailError) {
      console.error(
        `Confirmation email error for order ${order.order_id}:`,
        emailError.message
      );
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
   * Get checker status
   * @returns {Object} Current status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      processedCount: this.processedTransactions.size,
    };
  }
}

module.exports = new PaymentStatusChecker();
