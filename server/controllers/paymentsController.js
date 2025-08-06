const db = require("../config/db");
const crypto = require("crypto");

// Handler for POST /api/payments/dragonpay-callback
async function dragonpayCallback(req, res) {
  try {
    console.log("Received Dragonpay callback:", req.body);
    const { txnid, refno, status, message, param1 } = req.body;
    if (!txnid) {
      console.error("Missing transaction ID in Dragonpay callback");
      return res.status(400).send("MISSING_TXNID");
    }
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      let orderId = param1;
      if (!orderId && txnid) {
        const parts = txnid.split("_");
        if (parts.length >= 2) {
          orderId = parts[1];
        }
      }
      console.log(`Processing payment for extracted Order ID: ${orderId}`);
      if (!orderId) {
        await connection.rollback();
        console.error("Could not extract order ID from transaction ID:", txnid);
        return res.status(400).send("INVALID_ORDER_ID_FORMAT");
      }
      const [orders] = await connection.query(
        "SELECT * FROM orders WHERE order_id = ?",
        [orderId]
      );
      if (orders.length === 0) {
        await connection.rollback();
        console.error(`Order not found for ID: ${orderId}`);
        return res.status(404).send("ORDER_NOT_FOUND");
      }
      let orderStatus, paymentStatus;
      switch (status) {
        case "S":
          orderStatus = "processing";
          paymentStatus = "completed";
          break;
        case "F":
          orderStatus = "cancelled";
          paymentStatus = "failed";
          break;
        case "P":
          orderStatus = "pending";
          paymentStatus = "pending";
          break;
        case "R":
          orderStatus = "cancelled";
          paymentStatus = "refunded";
          break;
        case "K":
        case "V":
          orderStatus = "cancelled";
          paymentStatus = "failed";
          break;
        default:
          orderStatus = "pending";
          paymentStatus = "pending";
      }
      await connection.query(
        "UPDATE orders SET order_status = ?, updated_at = NOW() WHERE order_id = ?",
        [orderStatus, orderId]
      );
      await connection.query(
        "UPDATE payments SET status = ?, reference_number = ?, updated_at = NOW() WHERE order_id = ?",
        [paymentStatus, refno || null, orderId]
      );
      await connection.commit();
      console.log(
        `Successfully processed Dragonpay payment for Order ${orderId}. Status: ${status}, New order status: ${orderStatus}`
      );
      return res.status(200).send("OK");
    } catch (err) {
      await connection.rollback();
      console.error("Error processing Dragonpay callback:", err);
      return res.status(500).send("SERVER_ERROR");
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("Error in Dragonpay callback handler:", err);
    return res.status(500).send("SERVER_ERROR");
  }
}

module.exports = {
  dragonpayCallback,
};
