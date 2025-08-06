const db = require("./config/db");

async function debugShippingError() {
  try {
    console.log("=== DEBUGGING SHIPPING TABLE ERROR ===\n");

    // 1. Check if shipping table exists
    console.log("1. Checking if shipping table exists...");
    const [tables] = await db.query("SHOW TABLES LIKE 'shipping'");
    console.log("Tables found:", tables);

    if (tables.length === 0) {
      console.log("❌ SHIPPING TABLE DOES NOT EXIST!");
      return;
    }

    // 2. Show table structure
    console.log("\n2. Shipping table structure:");
    const [structure] = await db.query("DESCRIBE shipping");
    console.table(structure);

    // 3. Check columns specifically
    console.log("\n3. Checking for order_id column...");
    const orderIdColumn = structure.find((col) => col.Field === "order_id");
    if (orderIdColumn) {
      console.log("✅ order_id column EXISTS:", orderIdColumn);
    } else {
      console.log("❌ order_id column DOES NOT EXIST!");
      console.log(
        "Available columns:",
        structure.map((col) => col.Field)
      );
    }

    // 4. Test the exact queries that are failing
    console.log("\n4. Testing the exact queries that are failing...");

    // Query 1: SELECT * FROM shipping WHERE order_id = ?
    try {
      console.log("Testing: SELECT * FROM shipping WHERE order_id = 1007");
      const [result1] = await db.query(
        "SELECT * FROM shipping WHERE order_id = ?",
        [1007]
      );
      console.log("✅ Query 1 SUCCESS - found", result1.length, "records");
    } catch (error1) {
      console.log("❌ Query 1 FAILED:", error1.message);
    }

    // Query 2: UPDATE shipping SET status = ?, updated_at = NOW() WHERE order_id = ?
    try {
      console.log(
        "Testing: UPDATE shipping SET status = ?, updated_at = NOW() WHERE order_id = ?"
      );
      const [result2] = await db.query(
        "UPDATE shipping SET status = ?, updated_at = NOW() WHERE order_id = ?",
        ["test", 1007]
      );
      console.log("✅ Query 2 SUCCESS - affected rows:", result2.affectedRows);
    } catch (error2) {
      console.log("❌ Query 2 FAILED:", error2.message);
    }

    // 5. Check database connection info
    console.log("\n5. Database connection info:");
    const [dbInfo] = await db.query(
      "SELECT DATABASE() as current_db, USER() as current_user"
    );
    console.log("Current database:", dbInfo[0].current_db);
    console.log("Current user:", dbInfo[0].current_user);

    // 6. Show all shipping records
    console.log("\n6. All shipping records:");
    try {
      const [allRecords] = await db.query(
        "SELECT * FROM shipping ORDER BY created_at DESC LIMIT 5"
      );
      console.table(allRecords);
    } catch (error) {
      console.log("❌ Failed to fetch shipping records:", error.message);
    }
  } catch (error) {
    console.error("❌ Debug script error:", error.message);
  } finally {
    process.exit(0);
  }
}

debugShippingError();
