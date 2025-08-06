const db = require("./config/db");

async function testShippingQueries() {
  try {
    console.log("=== TESTING EXACT SHIPPING QUERIES THAT ARE FAILING ===\n");

    const orderId = 1008; // Using your latest order
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // Test 1: DESCRIBE shipping table
      console.log("1. Testing DESCRIBE shipping...");
      const [tableStructure] = await connection.query("DESCRIBE shipping");
      console.log("✅ DESCRIBE shipping successful");
      console.table(
        tableStructure.map((col) => ({
          Field: col.Field,
          Type: col.Type,
          Key: col.Key,
        }))
      );

      // Test 2: SELECT query that should work
      console.log("\n2. Testing SELECT * FROM shipping WHERE order_id = ?...");
      const [selectResult] = await connection.query(
        "SELECT * FROM shipping WHERE order_id = ?",
        [orderId]
      );
      console.log(
        `✅ SELECT query successful - found ${selectResult.length} records`
      );
      if (selectResult.length > 0) {
        console.log("First record:", {
          shipping_id: selectResult[0].shipping_id,
          order_id: selectResult[0].order_id,
          status: selectResult[0].status,
        });
      }

      // Test 3: UPDATE query that should work
      console.log(
        "\n3. Testing UPDATE shipping SET status = ? WHERE order_id = ?..."
      );
      const [updateResult] = await connection.query(
        "UPDATE shipping SET status = ?, updated_at = NOW() WHERE order_id = ?",
        ["test_status", orderId]
      );
      console.log(
        `✅ UPDATE query successful - affected rows: ${updateResult.affectedRows}`
      );

      // Test 4: Another UPDATE query with tracking_number
      console.log(
        "\n4. Testing UPDATE shipping SET tracking_number = ? WHERE order_id = ?..."
      );
      const [updateResult2] = await connection.query(
        "UPDATE shipping SET tracking_number = ?, carrier = ?, status = ?, updated_at = NOW() WHERE order_id = ?",
        ["TEST12345", "NinjaVan", "pending", orderId]
      );
      console.log(
        `✅ UPDATE tracking query successful - affected rows: ${updateResult2.affectedRows}`
      );

      // Test 5: Check the result
      console.log("\n5. Checking final state...");
      const [finalResult] = await connection.query(
        "SELECT * FROM shipping WHERE order_id = ?",
        [orderId]
      );
      console.log("Final record:", {
        shipping_id: finalResult[0]?.shipping_id,
        order_id: finalResult[0]?.order_id,
        status: finalResult[0]?.status,
        tracking_number: finalResult[0]?.tracking_number,
      });

      await connection.rollback(); // Don't save test changes
      console.log(
        "\n✅ ALL QUERIES SUCCESSFUL! The shipping table is working correctly."
      );
    } catch (queryError) {
      console.error("\n❌ QUERY ERROR:", queryError.message);
      console.error("Error code:", queryError.code);
      console.error("SQL State:", queryError.sqlState);
      await connection.rollback();
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("❌ Test script error:", error.message);
  } finally {
    process.exit(0);
  }
}

testShippingQueries();
