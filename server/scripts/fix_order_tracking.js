/**
 * Script to fix tracking information for a specific order
 *
 * Usage: node fix_order_tracking.js <orderId> <trackingNumber>
 * Example: node fix_order_tracking.js 148 NVSGFSMDM001485951
 */

const db = require("../config/db");

async function fixOrderTracking(orderId, trackingNumber) {
  if (!orderId || !trackingNumber) {
    console.error("Error: orderId and trackingNumber are required");
    console.log("Usage: node fix_order_tracking.js <orderId> <trackingNumber>");
    process.exit(1);
  }

  const connection = await db.getConnection();

  try {
    console.log(
      `Fixing tracking for order ${orderId} with tracking number ${trackingNumber}`
    );

    await connection.beginTransaction();

    // Update orders table
    const [orderResult] = await connection.query(
      "UPDATE orders SET tracking_number = ? WHERE order_id = ?",
      [trackingNumber, orderId]
    );

    console.log(
      `Updated orders table: ${orderResult.affectedRows} rows affected`
    );

    // Check if shipping record exists
    const [existingShipping] = await connection.query(
      "SELECT * FROM shipping WHERE order_id = ?",
      [orderId]
    );

    if (existingShipping.length > 0) {
      // Update existing shipping record
      const [shippingResult] = await connection.query(
        "UPDATE shipping SET tracking_number = ?, carrier = ?, updated_at = NOW() WHERE order_id = ?",
        [trackingNumber, "NinjaVan", orderId]
      );

      console.log(
        `Updated shipping table: ${shippingResult.affectedRows} rows affected`
      );
    } else {
      // Get user ID from order
      const [orders] = await connection.query(
        "SELECT user_id FROM orders WHERE order_id = ?",
        [orderId]
      );

      if (orders.length === 0) {
        throw new Error(`Order ${orderId} not found`);
      }

      // Create default shipping record
      const userId = orders[0].user_id;
      const [shippingInsertResult] = await connection.query(
        "INSERT INTO shipping (order_id, user_id, address, status, tracking_number, carrier, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())",
        [
          orderId,
          userId,
          "Address from order creation",
          "pending",
          trackingNumber,
          "NinjaVan",
        ]
      );

      console.log(
        `Created new shipping record: ${shippingInsertResult.insertId}`
      );
    }

    // Check for tracking events
    const [existingEvents] = await connection.query(
      "SELECT * FROM tracking_events WHERE tracking_number = ? AND order_id = ?",
      [trackingNumber, orderId]
    );

    if (existingEvents.length === 0) {
      // Add a tracking event
      const [eventResult] = await connection.query(
        "INSERT INTO tracking_events (tracking_number, order_id, status, description, created_at) VALUES (?, ?, ?, ?, NOW())",
        [trackingNumber, orderId, "pending", "Shipping order created"]
      );

      console.log(`Created tracking event: ${eventResult.insertId}`);
    } else {
      console.log(`Found ${existingEvents.length} existing tracking events`);
    }

    await connection.commit();
    console.log(`Successfully fixed tracking for order ${orderId}`);
  } catch (error) {
    await connection.rollback();
    console.error("Error fixing tracking:", error);
  } finally {
    connection.release();
  }
}

// Get arguments from command line
const orderId = process.argv[2];
const trackingNumber = process.argv[3];

// Run the function
fixOrderTracking(orderId, trackingNumber)
  .then(() => {
    console.log("Script completed");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
  });
