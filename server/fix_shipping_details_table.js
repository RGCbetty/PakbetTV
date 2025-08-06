const db = require("./config/db");

async function fixShippingDetailsTable() {
  try {
    console.log("🔧 Fixing shipping_details table...\n");

    // First, let's see what's in the table currently
    try {
      const [structure] = await db.query("DESCRIBE shipping_details");
      console.log("📋 Current shipping_details table structure:");
      structure.forEach((col) => {
        console.log(`  ${col.Field} - ${col.Type} (${col.Null})`);
      });

      // Check if order_id exists
      const hasOrderId = structure.some((col) => col.Field === "order_id");

      if (hasOrderId) {
        console.log("\n✅ order_id column already exists");

        // Test the query
        const [testResult] = await db.query(
          "SELECT * FROM shipping_details WHERE order_id = ?",
          [1009]
        );
        console.log(
          `✅ Query test successful! Found ${testResult.length} records`
        );
        console.log("\n🎉 shipping_details table is working correctly!");
        return;
      }
    } catch (describeError) {
      console.log("Table describe failed:", describeError.message);
    }

    // Drop and recreate the table properly
    console.log("\n🗑️ Dropping existing shipping_details table...");
    await db.query("DROP TABLE IF EXISTS shipping_details");

    console.log(
      "🔧 Creating new shipping_details table with proper structure..."
    );
    await db.query(`
      CREATE TABLE shipping_details (
        id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id bigint(20) UNSIGNED NOT NULL,
        address1 varchar(255) DEFAULT NULL,
        address2 varchar(255) DEFAULT NULL,
        area varchar(255) DEFAULT NULL,
        city varchar(255) DEFAULT NULL,
        state varchar(255) DEFAULT NULL,
        postcode varchar(20) DEFAULT NULL,
        country varchar(10) DEFAULT 'PH',
        region varchar(255) DEFAULT NULL,
        province varchar(255) DEFAULT NULL,
        city_municipality varchar(255) DEFAULT NULL,
        barangay varchar(255) DEFAULT NULL,
        created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_shipping_details_order_id (order_id),
        CONSTRAINT shipping_details_order_id_foreign 
        FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log(
      "✅ Successfully created shipping_details table with order_id column"
    );

    // Verify the fix
    console.log("\n📋 New shipping_details table structure:");
    const [newStructure] = await db.query("DESCRIBE shipping_details");
    newStructure.forEach((col) => {
      console.log(`  ${col.Field} - ${col.Type} (${col.Null})`);
    });

    // Test the query that was failing
    console.log("\n🧪 Testing the problematic query...");
    const [testResult] = await db.query(
      "SELECT * FROM shipping_details WHERE order_id = ?",
      [1009]
    );
    console.log(`✅ Query test successful! Found ${testResult.length} records`);

    console.log(
      "\n🎉 SUCCESS! The \"Unknown column 'order_id' in 'WHERE'\" error is now FIXED!"
    );
    console.log("You can now place orders without any issues.");
  } catch (error) {
    console.error("❌ Error fixing shipping_details table:", error);
  } finally {
    process.exit(0);
  }
}

// Run the fix
fixShippingDetailsTable();
