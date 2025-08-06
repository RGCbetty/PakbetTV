const fs = require("fs");
const path = require("path");
const db = require("../config/db");

async function addForeignKeyConstraint() {
  const connection = await db.getConnection();

  try {
    console.log(
      "🔧 Adding missing foreign key constraint for shipping.order_id...\n"
    );

    // Check if the constraint already exists
    const [existingConstraint] = await connection.query(`
      SELECT COUNT(*) as count
      FROM information_schema.TABLE_CONSTRAINTS 
      WHERE CONSTRAINT_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'shipping' 
      AND CONSTRAINT_NAME = 'shipping_order_id_foreign'
    `);

    if (existingConstraint[0].count > 0) {
      console.log("✅ Foreign key constraint already exists");
    } else {
      console.log("➕ Adding foreign key constraint...");

      await connection.query(`
        ALTER TABLE shipping 
        ADD CONSTRAINT shipping_order_id_foreign 
        FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
      `);

      console.log("✅ Foreign key constraint added successfully");
    }

    // Verify all foreign key constraints
    console.log("\n📋 Current foreign key constraints:");
    const [foreignKeys] = await connection.query(`
      SELECT 
        CONSTRAINT_NAME,
        COLUMN_NAME,
        REFERENCED_TABLE_NAME,
        REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'shipping' 
      AND REFERENCED_TABLE_NAME IS NOT NULL
    `);

    console.table(foreignKeys);

    // Test the problematic insert again
    console.log("\n🧪 Testing the insert that was previously failing...");

    try {
      // Clean up any existing test data first
      await connection.query("DELETE FROM shipping WHERE order_id = 8");
      await connection.query("DELETE FROM orders WHERE order_id = 8");

      // Create test order
      await connection.query(`
        INSERT INTO orders (order_id, user_id, total_price, order_status, payment_status, order_code, created_at, updated_at)
        VALUES (8, 13, 290.00, 'processing', 'pending', 'test-order-8', NOW(), NOW())
      `);

      // Test the shipping insert
      await connection.query(`
        INSERT INTO shipping (
          order_id, user_id, address, status, phone, email, name, created_at, updated_at
        ) VALUES (8, 13, 'Room 404, Benison Inn, N Bacalso Ave, Basacdacu, Alburquerque, Bohol, 6000', 'pending', '+639123456789', 'felixjuaton87@gmail.com', 'Felix III Juatons', NOW(), NOW())
      `);

      console.log("✅ Test insert SUCCESSFUL! The issue is now fixed.");

      // Clean up test data
      await connection.query("DELETE FROM shipping WHERE order_id = 8");
      await connection.query("DELETE FROM orders WHERE order_id = 8");
    } catch (insertError) {
      console.error("❌ Test insert still failing:", insertError.message);
      console.error("Error details:", insertError);
    }
  } catch (error) {
    console.error("❌ Error adding foreign key constraint:", error);
    throw error;
  } finally {
    connection.release();
  }
}

// Run the fix
if (require.main === module) {
  addForeignKeyConstraint()
    .then(() => {
      console.log("\n🎉 Foreign key constraint fix completed successfully!");
      console.log("You can now try placing your order again.");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Foreign key constraint fix failed:", error.message);
      process.exit(1);
    });
}

module.exports = { addForeignKeyConstraint };
