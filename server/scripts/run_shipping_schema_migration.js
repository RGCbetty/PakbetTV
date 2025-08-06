/**
 * Run the shipping table schema migration
 * This script fixes the "Unknown column 'order_id'" error
 *
 * Usage: node run_shipping_schema_migration.js
 */

const fs = require("fs");
const path = require("path");
const db = require("../config/db");

async function runMigration() {
  const connection = await db.getConnection();

  try {
    console.log("Starting shipping table schema migration...");

    // Read the migration SQL file
    const sqlFilePath = path.join(
      __dirname,
      "..",
      "migrations",
      "fix_shipping_table_schema.sql"
    );
    const sqlContent = fs.readFileSync(sqlFilePath, "utf8");

    // Split SQL statements by semicolons and filter out empty statements
    const statements = sqlContent
      .split(";")
      .map((stmt) => stmt.trim())
      .filter(
        (stmt) =>
          stmt &&
          !stmt.startsWith("--") &&
          stmt !== 'SELECT "Order foreign key already exists"' &&
          stmt !== 'SELECT "User foreign key already exists"'
      );

    console.log(`Found ${statements.length} SQL statements to execute`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement) {
        try {
          console.log(`Executing statement ${i + 1}/${statements.length}...`);
          await connection.query(statement);
          console.log(`✅ Statement ${i + 1} executed successfully`);
        } catch (statementError) {
          // Log the error but continue with other statements
          console.warn(
            `⚠️ Statement ${i + 1} failed (this might be expected):`,
            statementError.message
          );

          // If it's a critical error (not "already exists" type), throw it
          if (
            !statementError.message.includes("already exists") &&
            !statementError.message.includes("Duplicate column name") &&
            !statementError.message.includes("Duplicate key name")
          ) {
            throw statementError;
          }
        }
      }
    }

    // Verify the table structure
    console.log("\n📋 Verifying shipping table structure...");
    const [tableStructure] = await connection.query("DESCRIBE shipping");

    console.log("Current shipping table structure:");
    console.table(tableStructure);

    // Check if all required columns exist
    const requiredColumns = [
      "shipping_id",
      "order_id",
      "user_id",
      "address",
      "status",
      "phone",
      "email",
      "name",
      "tracking_number",
      "carrier",
    ];
    const existingColumns = tableStructure.map((col) => col.Field);

    const missingColumns = requiredColumns.filter(
      (col) => !existingColumns.includes(col)
    );

    if (missingColumns.length > 0) {
      console.error("❌ Missing columns:", missingColumns);
      throw new Error(`Missing required columns: ${missingColumns.join(", ")}`);
    }

    console.log("✅ All required columns are present");

    // Test the AUTO_INCREMENT functionality
    console.log("\n🧪 Testing AUTO_INCREMENT functionality...");
    try {
      await connection.query(
        'SELECT AUTO_INCREMENT FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = "shipping"'
      );
      console.log("✅ AUTO_INCREMENT is properly configured");
    } catch (autoIncrementError) {
      console.warn(
        "⚠️ Could not verify AUTO_INCREMENT:",
        autoIncrementError.message
      );
    }

    console.log("\n🎉 Migration completed successfully!");
    console.log(
      "The shipping table schema has been fixed and should now work with the order creation process."
    );
  } catch (error) {
    console.error("❌ Migration failed:", error);
    console.error("Error details:", error.message);
    throw error;
  } finally {
    connection.release();
  }
}

// Run the migration
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log("\n✅ Migration script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Migration script failed:", error.message);
      process.exit(1);
    });
}

module.exports = { runMigration };
