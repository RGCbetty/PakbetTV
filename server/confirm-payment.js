/**
 * This script manually updates an order's payment status to 'awaiting_for_confirmation'
 * for testing the payment confirmation flow.
 *
 * Usage: node confirm-payment.js <order_id>
 */

const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "fengshui db",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

async function updateOrderPaymentStatus(orderId) {
  if (!orderId) {
    console.error("Error: Order ID is required");
    console.log("Usage: node confirm-payment.js <order_id>");
    process.exit(1);
  }

  const connection = await mysql.createConnection(dbConfig);

  try {
    // Start transaction
    await connection.beginTransaction();

    // Check if order exists
    const [orders] = await connection.query(
      "SELECT * FROM orders WHERE order_id = ?",
      [orderId]
    );

    if (orders.length === 0) {
      console.error(`Order with ID ${orderId} not found`);
      await connection.rollback();
      process.exit(1);
    }

    // Update order status
    await connection.query(
      "UPDATE orders SET order_status = ?, payment_status = ?, updated_at = NOW() WHERE order_id = ?",
      ["processing", "awaiting_for_confirmation", orderId]
    );

    // Update payment status (assuming the payment exists)
    const [payments] = await connection.query(
      "SELECT * FROM payments WHERE order_id = ? ORDER BY payment_id DESC LIMIT 1",
      [orderId]
    );

    if (payments.length > 0) {
      await connection.query(
        "UPDATE payments SET status = ?, updated_at = NOW() WHERE payment_id = ?",
        ["waiting_for_confirmation", payments[0].payment_id]
      );
    } else {
      console.warn(
        `No payment found for order ${orderId}, creating a new payment entry`
      );

      // Get order details for amount and user_id
      const [orderDetails] = await connection.query(
        "SELECT user_id, total_price FROM orders WHERE order_id = ?",
        [orderId]
      );

      if (orderDetails.length > 0) {
        // Create a new payment entry
        await connection.query(
          "INSERT INTO payments (order_id, user_id, amount, payment_method, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())",
          [
            orderId,
            orderDetails[0].user_id,
            orderDetails[0].total_price,
            "dragonpay",
            "waiting_for_confirmation",
          ]
        );
      }
    }

    // Commit changes
    await connection.commit();

    console.log(
      `Successfully updated order ${orderId} to processing with awaiting_for_confirmation payment status`
    );
    console.log(
      `You can now test the payment confirmation endpoint at: POST /api/admin/confirm-payment/${orderId}`
    );
  } catch (error) {
    await connection.rollback();
    console.error("Error updating order payment status:", error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

// Get order ID from command line arguments
const orderId = process.argv[2];
updateOrderPaymentStatus(orderId);
