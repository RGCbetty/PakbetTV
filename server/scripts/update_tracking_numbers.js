/**
 * Script to fix tracking numbers in the orders table
 *
 * This script finds all shipping records with tracking numbers and copies
 * those tracking numbers to the corresponding orders table records.
 *
 * Usage: node update_tracking_numbers.js
 */

const db = require("../config/db");

async function updateTrackingNumbers() {
  const connection = await db.getConnection();

  try {
    console.log("Starting tracking number update...");

    // Find all shipping records with tracking numbers
    const [shipping] = await connection.query(
      "SELECT order_id, tracking_number FROM shipping WHERE tracking_number IS NOT NULL"
    );

    console.log(
      `Found ${shipping.length} shipping records with tracking numbers`
    );

    let updatedCount = 0;

    // Update each order that doesn't already have a tracking number
    for (const record of shipping) {
      const [result] = await connection.query(
        'UPDATE orders SET tracking_number = ? WHERE order_id = ? AND (tracking_number IS NULL OR tracking_number = "")',
        [record.tracking_number, record.order_id]
      );

      if (result.affectedRows > 0) {
        updatedCount++;
        console.log(
          `Updated order ${record.order_id} with tracking number ${record.tracking_number}`
        );
      }
    }

    console.log(
      `Finished updating ${updatedCount} orders with tracking numbers`
    );
  } catch (error) {
    console.error("Error updating tracking numbers:", error);
  } finally {
    connection.release();
  }
}

// Run the function
updateTrackingNumbers()
  .then(() => {
    console.log("Script completed");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
  });
