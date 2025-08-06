const crypto = require("crypto");
const config = require("../config/keys");
const db = require("../config/db");
const {
  sendOrderDispatchedEmail,
  sendDeliveryNotificationEmail,
} = require("../services/emailService");

/**
 * NinjaVan Webhooks V2 Handler
 * Implements complete V2 specification with all event types
 */
class NinjaVanWebhookV2Handler {
  /**
   * Verify webhook signature according to V2 spec
   */
  static verifySignature(req, res, next) {
    try {
      const receivedHmac = req.headers["x-ninjavan-hmac-sha256"];
      if (!receivedHmac) {
        console.error("❌ Missing NinjaVan HMAC signature");
        return res
          .status(401)
          .json({ message: "Unauthorized: Missing signature" });
      }

      let rawBody = req.rawBody;
      if (!rawBody) {
        console.error("❌ Raw body not available for signature verification");
        return res
          .status(401)
          .json({ message: "Unauthorized: Cannot verify signature" });
      }

      if (Buffer.isBuffer(rawBody)) {
        rawBody = rawBody.toString("utf8");
      }

      const clientSecret = config.NINJAVAN_CLIENT_SECRET;
      if (!clientSecret) {
        console.error("❌ NinjaVan client secret not configured");
        return res.status(500).json({ message: "Server configuration error" });
      }

      const calculatedHmac = crypto
        .createHmac("sha256", clientSecret)
        .update(rawBody)
        .digest("base64");

      if (calculatedHmac !== receivedHmac) {
        console.error("❌ Invalid NinjaVan HMAC signature");
        return res
          .status(401)
          .json({ message: "Unauthorized: Invalid signature" });
      }

      console.log("✅ NinjaVan V2 signature verified successfully");
      next();
    } catch (error) {
      console.error("❌ Error verifying webhook signature:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }

  /**
   * Parse ISO 8601 timestamp with timezone information
   */
  static parseTimestamp(timestamp) {
    try {
      return new Date(timestamp);
    } catch (error) {
      console.error("❌ Error parsing timestamp:", timestamp, error);
      return new Date();
    }
  }

  /**
   * Extract failure reason from V2 payload
   */
  static extractFailureReason(webhookData) {
    if (webhookData.pickup_exception?.failure_reason) {
      return webhookData.pickup_exception.failure_reason;
    }
    if (webhookData.delivery_exception?.failure_reason) {
      return webhookData.delivery_exception.failure_reason;
    }
    return null;
  }

  /**
   * Determine if event is terminal status
   */
  static isTerminalStatus(event) {
    const terminalEvents = [
      "Pickup Exception, Max Attempts Reached",
      "Delivered, Collected by Customer",
      "Delivered, Left at Doorstep",
      "Delivered, Received by Customer",
      "Returned to Sender",
      "Cancelled",
      "International Transit, Returned to Sender at Origin Facility",
      "International Transit, Returned to XB Warehouse",
    ];
    return terminalEvents.includes(event);
  }

  /**
   * Save webhook event to database for audit
   */
  static async saveWebhookEvent(webhookData) {
    try {
      const parsedTimestamp = this.parseTimestamp(webhookData.timestamp);
      const failureReason = this.extractFailureReason(webhookData);
      const isTerminal = this.isTerminalStatus(webhookData.event);

      await db.query(
        `
        INSERT INTO ninjavan_webhook_events 
        (tracking_id, event, status, timestamp, raw_payload, failure_reason, is_terminal, is_rts_leg)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          webhookData.tracking_id,
          webhookData.event,
          webhookData.status,
          parsedTimestamp,
          JSON.stringify(webhookData),
          failureReason,
          isTerminal,
          webhookData.is_parcel_on_rts_leg || false,
        ]
      );

      console.log(
        `📝 Webhook event saved: ${webhookData.event} for ${webhookData.tracking_id}`
      );
    } catch (error) {
      console.error("❌ Error saving webhook event:", error);
      // Don't throw - webhook processing should continue even if audit logging fails
    }
  }

  /**
   * Map V2 events to internal order statuses
   */
  static mapEventToOrderStatus(event, currentStatus) {
    const statusMap = {
      // Pickup Events
      "Pending Pickup": {
        status: "for_shipping",
        shouldUpdate: true,
        description: "Order ready for pickup",
      },
      "Driver dispatched for Pickup": {
        status: "for_shipping",
        shouldUpdate: true,
        description: "Driver dispatched for pickup",
      },
      "Picked Up, In Transit To Origin Hub": {
        status: "picked_up",
        shouldUpdate: true,
        description: "Order picked up by courier",
      },
      "Pending Pickup, Shipper Dropoff": {
        status: "for_shipping",
        shouldUpdate: true,
        description: "Order at pickup point",
      },

      // Pickup Exceptions
      "Pickup Exception, Pending Reschedule": {
        status: "for_shipping",
        shouldUpdate: false,
        description: "Pickup failed, rescheduling",
      },
      "Pickup Exception, Reattempt Scheduled": {
        status: "for_shipping",
        shouldUpdate: false,
        description: "Pickup rescheduled",
      },
      "Pickup Exception, Max Attempts Reached": {
        status: "pickup_failed",
        shouldUpdate: true,
        description: "Pickup failed - max attempts reached",
      },
      "Pickup Exception, Pending Retrieval from PUDO": {
        status: "for_shipping",
        shouldUpdate: false,
        description: "Awaiting pickup from PUDO",
      },

      // Transit Events
      "Arrived at Origin Hub": {
        status: "shipped",
        shouldUpdate: true,
        description: "Arrived at origin facility",
      },
      "Arrived at Transit Hub": {
        status: "shipped",
        shouldUpdate: true,
        description: "Arrived at transit facility",
      },
      "Arrived at Destination Hub": {
        status: "shipped",
        shouldUpdate: true,
        description: "Arrived at destination facility",
      },
      "In Transit to Next Sorting Hub": {
        status: "shipped",
        shouldUpdate: true,
        description: "In transit between facilities",
      },

      // Delivery Events
      "On Vehicle for Delivery": {
        status: "out_for_delivery",
        shouldUpdate: true,
        description: "Out for delivery",
      },
      "At PUDO, Pending Customer Collection": {
        status: "out_for_delivery",
        shouldUpdate: true,
        description: "At pickup point, awaiting customer",
      },

      // Delivered Events (Terminal)
      "Delivered, Collected by Customer": {
        status: "delivered",
        shouldUpdate: true,
        description: "Delivered - collected by customer",
      },
      "Delivered, Left at Doorstep": {
        status: "delivered",
        shouldUpdate: true,
        description: "Delivered - left at doorstep",
      },
      "Delivered, Received by Customer": {
        status: "delivered",
        shouldUpdate: true,
        description: "Delivered - received by customer",
      },

      // Delivery Exceptions
      "Delivery Exception, Pending Reschedule": {
        status: "delivery_exception",
        shouldUpdate: true,
        description: "Delivery failed, rescheduling",
      },
      "Delivery Exception, Reattempt Scheduled": {
        status: "delivery_exception",
        shouldUpdate: true,
        description: "Delivery rescheduled",
      },
      "Delivery Exception, Max Attempts Reached": {
        status: "delivery_failed",
        shouldUpdate: true,
        description: "Delivery failed - max attempts reached",
      },
      "Delivery Exception, Parcel Overstayed at PUDO": {
        status: "delivery_exception",
        shouldUpdate: true,
        description: "Parcel overstayed at pickup point",
      },
      "Delivery Exception, Parcel Lost": {
        status: "delivery_exception",
        shouldUpdate: true,
        description: "Parcel lost",
      },
      "Delivery Exception, Parcel Damaged": {
        status: "delivery_exception",
        shouldUpdate: true,
        description: "Parcel damaged",
      },
      "Delivery Exception, Return to Sender Initiated": {
        status: "returning",
        shouldUpdate: true,
        description: "Return to sender initiated",
      },

      // Terminal Events
      "Returned to Sender": {
        status: "returned",
        shouldUpdate: true,
        description: "Returned to sender",
      },
      Cancelled: {
        status: "cancelled",
        shouldUpdate: true,
        description: "Order cancelled",
      },

      // Special Events
      "Parcel Measurements Update": {
        status: currentStatus,
        shouldUpdate: false,
        description: "Parcel measurements updated",
      },

      // International Transit Events
      "International Transit, Handed Over to Origin Facility": {
        status: "shipped",
        shouldUpdate: true,
        description: "International - at origin facility",
      },
      "International Transit, Arrived at Origin Facility": {
        status: "shipped",
        shouldUpdate: true,
        description: "International - arrived at origin",
      },
      "International Transit, Processed at Origin Facility": {
        status: "shipped",
        shouldUpdate: true,
        description: "International - processed at origin",
      },
      "International Transit, Handed Over to Linehaul": {
        status: "shipped",
        shouldUpdate: true,
        description: "International - handed to linehaul",
      },
      "International Transit, Export Cleared": {
        status: "shipped",
        shouldUpdate: true,
        description: "International - export cleared",
      },
      "International Transit, Linehaul Departed": {
        status: "shipped",
        shouldUpdate: true,
        description: "International - departed",
      },
      "International Transit, Linehaul Scheduled": {
        status: "shipped",
        shouldUpdate: true,
        description: "International - linehaul scheduled",
      },
      "International Transit, Linehaul Arrived": {
        status: "shipped",
        shouldUpdate: true,
        description: "International - arrived at destination",
      },
      "International Transit, Customs Cleared": {
        status: "shipped",
        shouldUpdate: true,
        description: "International - customs cleared",
      },
      "International Transit, Customs Held": {
        status: "customs_hold",
        shouldUpdate: true,
        description: "International - held at customs",
      },
      "International Transit, Handed Over to Last Mile": {
        status: "shipped",
        shouldUpdate: true,
        description: "International - handed to last mile",
      },
      "International Transit, Returned to Sender at Origin Facility": {
        status: "returned",
        shouldUpdate: true,
        description: "International - returned to sender",
      },
      "International Transit, Returned to XB Warehouse": {
        status: "returned",
        shouldUpdate: true,
        description: "International - returned to warehouse",
      },
      "International Transit, Fulfillment Request Submitted": {
        status: "shipped",
        shouldUpdate: false,
        description: "International - fulfillment requested",
      },
      "International Transit, Fulfillment Packed": {
        status: "shipped",
        shouldUpdate: false,
        description: "International - fulfillment packed",
      },
      "International Transit, En Route to Origin Facility": {
        status: "shipped",
        shouldUpdate: true,
        description: "International - en route to origin",
      },
      "International Transit, Parcel Exception": {
        status: "delivery_exception",
        shouldUpdate: true,
        description: "International - parcel exception",
      },
      "International Transit, Parcel Disposed": {
        status: "cancelled",
        shouldUpdate: true,
        description: "International - parcel disposed",
      },
      "International Transit, Parcel Lost": {
        status: "delivery_exception",
        shouldUpdate: true,
        description: "International - parcel lost",
      },
      "International Transit, Parcel Damaged": {
        status: "delivery_exception",
        shouldUpdate: true,
        description: "International - parcel damaged",
      },

      // Return to Shipper Exception Events
      "Return to Shipper Exception, Parcel triggered for Shipper Collection": {
        status: "returning",
        shouldUpdate: true,
        description: "Return exception - awaiting shipper collection",
      },
      "Return to Shipper Exception, Parcel collected by Shipper": {
        status: "returned",
        shouldUpdate: true,
        description: "Return exception - collected by shipper",
      },
      "Return to Shipper Exception, Parcel Scrapped": {
        status: "cancelled",
        shouldUpdate: true,
        description: "Return exception - parcel scrapped",
      },
      "Return to Shipper Exception, Max Attempts Reached": {
        status: "return_failed",
        shouldUpdate: true,
        description: "Return exception - max attempts reached",
      },
    };

    return (
      statusMap[event] || {
        status: currentStatus,
        shouldUpdate: false,
        description: `Unknown event: ${event}`,
      }
    );
  }

  /**
   * Update order status in database
   */
  static async updateOrderStatus(order, statusMapping, webhookData) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      if (statusMapping.shouldUpdate) {
        // Update order status
        await connection.query(
          "UPDATE orders SET order_status = ?, updated_at = NOW() WHERE order_id = ?",
          [statusMapping.status, order.order_id]
        );

        console.log(
          `✅ Order ${order.order_id} status updated: ${order.order_status} → ${statusMapping.status}`
        );
      }

      // Always update shipping table with latest webhook info
      const failureReason = this.extractFailureReason(webhookData);
      await connection.query(
        `
        UPDATE shipping SET 
          status = ?, 
          failure_reason = ?,
          is_rts_leg = ?,
          last_webhook_event = ?,
          last_webhook_timestamp = ?,
          updated_at = NOW() 
        WHERE order_id = ?
      `,
        [
          statusMapping.status,
          failureReason,
          webhookData.is_parcel_on_rts_leg || false,
          webhookData.event,
          this.parseTimestamp(webhookData.timestamp),
          order.order_id,
        ]
      );

      await connection.commit();
      console.log(`📦 Shipping info updated for order ${order.order_id}`);
    } catch (error) {
      await connection.rollback();
      console.error(`❌ Error updating order ${order.order_id}:`, error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Handle special actions for specific events
   */
  static async handleSpecialActions(order, event, webhookData) {
    try {
      switch (event) {
        case "Picked Up, In Transit To Origin Hub":
          // Send dispatch notification
          await sendOrderDispatchedEmail(order.email, {
            orderId: order.order_id,
            trackingNumber: webhookData.tracking_id,
            customerName: `${order.first_name} ${order.last_name || ""}`.trim(),
          });
          break;

        case "Delivered, Collected by Customer":
        case "Delivered, Left at Doorstep":
        case "Delivered, Received by Customer":
          // Send delivery notification and request review
          await sendDeliveryNotificationEmail(order.email, {
            orderId: order.order_id,
            customerName: `${order.first_name} ${order.last_name || ""}`.trim(),
            trackingNumber: webhookData.tracking_id,
          });
          break;

        case "Pickup Exception, Max Attempts Reached":
        case "Delivery Exception, Max Attempts Reached":
          // Could send failure notification email here
          console.log(
            `⚠️ Max attempts reached for order ${
              order.order_id
            }: ${this.extractFailureReason(webhookData)}`
          );
          break;

        default:
          // No special action needed
          break;
      }
    } catch (error) {
      console.error(`❌ Error in special actions for event ${event}:`, error);
      // Don't throw - webhook should still succeed even if special actions fail
    }
  }

  /**
   * Main V2 webhook handler
   */
  static async handleWebhook(req, res) {
    try {
      console.log(
        "🔄 NinjaVan V2 Webhook received:",
        JSON.stringify(req.body, null, 2)
      );

      // Extract V2 payload structure
      const {
        tracking_id,
        shipper_order_ref_no,
        timestamp,
        event,
        status,
        is_parcel_on_rts_leg = false,

        // V2 specific data structures
        pickup_exception,
        delivery_exception,
        delivery_information,
        international_transit_information,
        parcel_measurements_information,
        cancellation_information,
        recovery_information,

        // Additional fields
        from_address,
        to_address,
        comments,
        failure_reason,
        delivery_instructions,
        updated_by,
      } = req.body;

      // Validate required fields
      if (!tracking_id || !event || !status) {
        console.error("❌ Missing required fields in webhook payload");
        return res.status(400).json({
          error: "Missing required fields: tracking_id, event, status",
        });
      }

      // Save webhook event for audit
      await this.saveWebhookEvent(req.body);

      // Find associated order
      const [orders] = await db.query(
        `
        SELECT o.order_id, o.order_status, o.user_id, o.total_price, o.payment_status,
               u.first_name, u.last_name, u.email, u.phone, u.user_type
        FROM shipping s 
        JOIN orders o ON s.order_id = o.order_id
        JOIN users u ON o.user_id = u.user_id
        WHERE s.tracking_number = ?
      `,
        [tracking_id]
      );

      if (orders.length === 0) {
        console.error(`❌ No order found for tracking number: ${tracking_id}`);
        return res.status(404).json({ error: "Order not found" });
      }

      const order = orders[0];
      console.log(
        `📦 Processing V2 webhook for Order ID: ${order.order_id}, Event: ${event}, Status: ${status}`
      );

      // Map event to internal status
      const statusMapping = this.mapEventToOrderStatus(
        event,
        order.order_status
      );

      // Update order status if needed
      await this.updateOrderStatus(order, statusMapping, req.body);

      // Handle special actions
      await this.handleSpecialActions(order, event, req.body);

      // Respond with success
      res.status(200).json({
        success: true,
        message: "V2 webhook processed successfully",
        order_id: order.order_id,
        event: event,
        status: status,
        new_order_status: statusMapping.status,
        is_terminal: this.isTerminalStatus(event),
      });
    } catch (error) {
      console.error("❌ Error processing NinjaVan V2 webhook:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

module.exports = NinjaVanWebhookV2Handler;
