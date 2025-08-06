const db = require("../config/db");

async function deepInvestigation() {
  try {
    console.log("=== Deep Investigation of Database Issue ===\n");

    // Check if we're connecting to the right database
    const [dbInfo] = await db.query(
      "SELECT DATABASE() as current_db, USER() as current_user"
    );
    console.log("Current database connection:");
    console.table(dbInfo);

    // Check all tables in current database
    const [tables] = await db.query("SHOW TABLES");
    console.log("\nAll tables in database:");
    console.table(tables);

    // Check if there are multiple shipping tables
    const [shippingTables] = await db.query(`
      SELECT TABLE_NAME, TABLE_SCHEMA 
      FROM information_schema.TABLES 
      WHERE TABLE_NAME LIKE '%shipping%'
    `);
    console.log("\nAll shipping-related tables:");
    console.table(shippingTables);

    // Try a different approach - check the exact table the error is happening on
    console.log("\n=== Testing Different Approaches ===");

    // Try 1: Use SHOW CREATE TABLE to see the exact structure
    try {
      const [createTable] = await db.query("SHOW CREATE TABLE shipping");
      console.log("\nCREATE TABLE statement for shipping:");
      console.log(createTable[0]["Create Table"]);
    } catch (error) {
      console.error("Error getting CREATE TABLE:", error.message);
    }

    // Try 2: Test insert without foreign key validation
    console.log("\n=== Testing Insert with Foreign Key Checks Disabled ===");
    try {
      await db.query("SET FOREIGN_KEY_CHECKS = 0");

      // Clean up first
      await db.query("DELETE FROM shipping WHERE order_id = 999");
      await db.query("DELETE FROM orders WHERE order_id = 999");

      // Create test order
      await db.query(`
        INSERT INTO orders (order_id, user_id, total_price, order_status, payment_status, order_code, created_at, updated_at)
        VALUES (999, 13, 290.00, 'processing', 'pending', 'test-999', NOW(), NOW())
      `);

      // Test shipping insert
      await db.query(`
        INSERT INTO shipping (
          order_id, user_id, address, status, phone, email, name, created_at, updated_at
        ) VALUES (999, 13, 'Test Address', 'pending', '09123456789', 'test@test.com', 'Test User', NOW(), NOW())
      `);

      console.log("✅ Insert successful with FK checks disabled");

      // Re-enable foreign key checks
      await db.query("SET FOREIGN_KEY_CHECKS = 1");

      // Clean up
      await db.query("DELETE FROM shipping WHERE order_id = 999");
      await db.query("DELETE FROM orders WHERE order_id = 999");
    } catch (fkError) {
      console.error(
        "❌ Insert failed even with FK checks disabled:",
        fkError.message
      );
      await db.query("SET FOREIGN_KEY_CHECKS = 1"); // Re-enable
    }

    // Try 3: Check for any views or synonyms
    const [views] = await db.query(`
      SELECT TABLE_NAME, TABLE_TYPE 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'shipping'
    `);
    console.log("\nShipping table type:");
    console.table(views);

    process.exit(0);
  } catch (error) {
    console.error("Investigation error:", error);
    process.exit(1);
  }
}

deepInvestigation();
