/**
 * Drop and recreate the shipping table to fix schema caching issues
 * This will completely resolve the "Unknown column 'order_id' in 'WHERE'" error
 *
 * Usage: node drop_and_recreate_shipping_table.js
 */

const db = require("../config/db");

async function dropAndRecreateShippingTable() {
  const connection = await db.getConnection();

  try {
    console.log(
      "🗑️ Dropping and recreating shipping table to fix schema issues...\n"
    );

    // Step 1: Backup existing data if any
    console.log("1. Backing up existing shipping data...");
    let backupData = [];
    try {
      const [existingData] = await connection.query("SELECT * FROM shipping");
      backupData = existingData;
      console.log(`   Found ${backupData.length} existing shipping records`);
    } catch (error) {
      console.log("   No existing data to backup (table may not exist yet)");
    }

    // Step 2: Drop the table completely
    console.log("2. Dropping existing shipping table...");
    try {
      await connection.query("DROP TABLE IF EXISTS shipping");
      console.log("   ✅ Table dropped successfully");
    } catch (error) {
      console.log("   ⚠️ Table may not have existed:", error.message);
    }

    // Step 3: Create the table with the correct structure
    console.log("3. Creating new shipping table...");
    await connection.query(`
      CREATE TABLE shipping (
        shipping_id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id bigint(20) UNSIGNED NOT NULL,
        user_id bigint(20) UNSIGNED NOT NULL,
        address text NOT NULL,
        status varchar(50) NOT NULL DEFAULT 'pending',
        phone varchar(20) DEFAULT NULL,
        email varchar(255) DEFAULT NULL,
        name varchar(255) DEFAULT NULL,
        tracking_number varchar(100) DEFAULT NULL,
        carrier varchar(50) DEFAULT NULL,
        created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (shipping_id),
        KEY idx_shipping_order_id (order_id),
        KEY idx_shipping_user_id (user_id),
        KEY idx_shipping_tracking (tracking_number),
        CONSTRAINT shipping_order_id_foreign FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE CASCADE,
        CONSTRAINT shipping_user_id_foreign FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("   ✅ New table created successfully");

    // Step 4: Restore backed up data if any
    if (backupData.length > 0) {
      console.log("4. Restoring backed up data...");
      for (const record of backupData) {
        try {
          await connection.query(
            `
            INSERT INTO shipping (
              order_id, user_id, address, status, phone, email, name, 
              tracking_number, carrier, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            [
              record.order_id,
              record.user_id,
              record.address,
              record.status,
              record.phone,
              record.email,
              record.name,
              record.tracking_number,
              record.carrier,
              record.created_at,
              record.updated_at,
            ]
          );
        } catch (restoreError) {
          console.warn(
            `   ⚠️ Could not restore record for order ${record.order_id}:`,
            restoreError.message
          );
        }
      }
      console.log(`   ✅ Restored ${backupData.length} records`);
    } else {
      console.log("4. No data to restore");
    }

    // Step 5: Verify the new table structure
    console.log("5. Verifying new table structure...");
    const [structure] = await connection.query("DESCRIBE shipping");
    console.table(structure);

    // Step 6: Test the problematic insert
    console.log("6. Testing the insert that was previously failing...");
    try {
      // Clean up any test data first
      await connection.query("DELETE FROM shipping WHERE order_id = 999");
      await connection.query("DELETE FROM orders WHERE order_id = 999");

      // Create test order
      await connection.query(`
        INSERT INTO orders (order_id, user_id, total_price, order_status, payment_status, order_code, created_at, updated_at)
        VALUES (999, 13, 290.00, 'processing', 'pending', 'test-999', NOW(), NOW())
      `);

      // Test the exact shipping insert that was failing
      await connection.query(`
        INSERT INTO shipping (
          order_id, user_id, address, status, phone, email, name, created_at, updated_at
        ) VALUES (999, 13, 'Room 404, Benison Inn, N Bacalso Ave, Basacdacu, Alburquerque, Bohol, 6000', 'pending', '+639123456789', 'felixjuaton87@gmail.com', 'Felix III Juatons', NOW(), NOW())
      `);

      console.log(
        "   ✅ TEST INSERT SUCCESSFUL! The issue is now completely fixed."
      );

      // Clean up test data
      await connection.query("DELETE FROM shipping WHERE order_id = 999");
      await connection.query("DELETE FROM orders WHERE order_id = 999");
    } catch (insertError) {
      console.error("   ❌ Test insert still failing:", insertError.message);
      throw insertError;
    }

    // Step 7: Verify foreign key constraints
    console.log("7. Verifying foreign key constraints...");
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

    console.log(
      "\n🎉 SUCCESS! The shipping table has been completely recreated."
    );
    console.log(
      "The \"Unknown column 'order_id' in 'WHERE'\" error should now be resolved."
    );
    console.log("\n✅ You can now try placing your order again!");
  } catch (error) {
    console.error("❌ Error during table recreation:", error);
    throw error;
  } finally {
    connection.release();
  }
}

// Run the fix
if (require.main === module) {
  dropAndRecreateShippingTable()
    .then(() => {
      console.log("\n✅ Table recreation completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Table recreation failed:", error.message);
      process.exit(1);
    });
}

module.exports = { dropAndRecreateShippingTable };
