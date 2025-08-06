const db = require("../config/db");

async function checkShippingSchema() {
  try {
    console.log("=== Checking Shipping Table Schema ===\n");

    // Check table structure
    const [structure] = await db.query("DESCRIBE shipping");
    console.log("1. Current shipping table structure:");
    console.table(structure);

    // Check if orders table exists and has proper structure
    console.log("\n2. Checking orders table structure:");
    const [ordersStructure] = await db.query("DESCRIBE orders");
    console.table(ordersStructure);

    // Test the exact insert that's failing
    console.log("\n3. Testing the exact insert that is failing...");
    try {
      // First, let's check if there's an order with ID 8
      const [existingOrder] = await db.query(
        "SELECT * FROM orders WHERE order_id = 8"
      );
      console.log("Order 8 exists:", existingOrder.length > 0);

      if (existingOrder.length === 0) {
        console.log("Creating test order first...");
        await db.query(`
          INSERT INTO orders (order_id, user_id, total_price, order_status, payment_status, order_code, created_at, updated_at)
          VALUES (8, 13, 290.00, 'processing', 'pending', 'test-order-8', NOW(), NOW())
        `);
      }

      // Now test the shipping insert
      await db.query(`
        INSERT INTO shipping (
          order_id, user_id, address, status, phone, email, name, created_at, updated_at
        ) VALUES (8, 13, 'Room 404, Benison Inn, N Bacalso Ave, Basacdacu, Alburquerque, Bohol, 6000', 'pending', '+639123456789', 'felixjuaton87@gmail.com', 'Felix III Juatons', NOW(), NOW())
      `);
      console.log("✅ Test insert successful");

      // Clean up test data
      await db.query("DELETE FROM shipping WHERE order_id = 8");
      await db.query("DELETE FROM orders WHERE order_id = 8");
    } catch (insertError) {
      console.error("❌ Test insert failed:", insertError.message);
      console.error("Error code:", insertError.code);
      console.error("SQL State:", insertError.sqlState);
      console.error("Full SQL:", insertError.sql);
    }

    // Check foreign key constraints
    console.log("\n4. Checking foreign key constraints:");
    const [foreignKeys] = await db.query(`
      SELECT 
        kcu.CONSTRAINT_NAME,
        kcu.COLUMN_NAME,
        kcu.REFERENCED_TABLE_NAME,
        kcu.REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE kcu
      WHERE kcu.TABLE_SCHEMA = DATABASE() 
      AND kcu.TABLE_NAME = 'shipping'
      AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
    `);
    console.table(foreignKeys);

    // Check if there are any triggers
    console.log("\n5. Checking for triggers:");
    const [triggers] = await db.query(`
      SELECT TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE, ACTION_STATEMENT
      FROM information_schema.TRIGGERS 
      WHERE EVENT_OBJECT_SCHEMA = DATABASE() 
      AND EVENT_OBJECT_TABLE = 'shipping'
    `);

    if (triggers.length > 0) {
      console.table(triggers);
    } else {
      console.log("No triggers found");
    }

    process.exit(0);
  } catch (error) {
    console.error("Error checking schema:", error);
    process.exit(1);
  }
}

checkShippingSchema();
