const db = require("./config/db");

async function checkAndFixShippingDetailsTable() {
  try {
    console.log("🔍 Checking shipping_details table structure...\n");

    // Check if table exists and its current structure
    try {
      const [structure] = await db.query("DESCRIBE shipping_details");
      console.log("📋 Current shipping_details table structure:");
      console.table(
        structure.map((col) => ({
          Field: col.Field,
          Type: col.Type,
          Null: col.Null,
          Key: col.Key,
        }))
      );

      // Check if order_id column exists
      const hasOrderId = structure.some((col) => col.Field === "order_id");

      if (hasOrderId) {
        console.log(
          "✅ order_id column already exists in shipping_details table"
        );
        return;
      } else {
        console.log(
          "❌ order_id column is MISSING from shipping_details table"
        );
        console.log("🔧 Adding order_id column...\n");

        // Add the missing order_id column
        await db.query(`
          ALTER TABLE shipping_details 
          ADD COLUMN order_id bigint(20) UNSIGNED NOT NULL FIRST,
          ADD INDEX idx_shipping_details_order_id (order_id),
          ADD CONSTRAINT shipping_details_order_id_foreign 
          FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE CASCADE
        `);

        console.log(
          "✅ Successfully added order_id column to shipping_details table"
        );

        // Verify the fix
        const [newStructure] = await db.query("DESCRIBE shipping_details");
        console.log("\n📋 Updated shipping_details table structure:");
        console.table(
          newStructure.map((col) => ({
            Field: col.Field,
            Type: col.Type,
            Null: col.Null,
            Key: col.Key,
          }))
        );
      }
    } catch (tableError) {
      if (tableError.code === "ER_NO_SUCH_TABLE") {
        console.log("❌ shipping_details table does not exist");
        console.log("🔧 Creating shipping_details table...\n");

        // Create the shipping_details table with all necessary columns
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

        console.log("✅ Successfully created shipping_details table");
      } else {
        throw tableError;
      }
    }

    // Test the fix by trying the problematic query
    console.log("\n🧪 Testing the fixed query...");
    try {
      const [testResult] = await db.query(
        "SELECT * FROM shipping_details WHERE order_id = ?",
        [1009]
      );
      console.log(
        `✅ Query test successful! Found ${testResult.length} records`
      );
      console.log(
        "\n🎉 The \"Unknown column 'order_id' in 'WHERE'\" error should now be FIXED!"
      );
    } catch (testError) {
      console.error("❌ Query test failed:", testError.message);
    }
  } catch (error) {
    console.error("❌ Error checking/fixing shipping_details table:", error);
  } finally {
    process.exit(0);
  }
}

// Run the check and fix
checkAndFixShippingDetailsTable();
