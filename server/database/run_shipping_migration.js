/**
 * Shipping Details Migration Script
 *
 * This script helps migrate existing shipping data to the new structured format
 * It should be run after the database schema has been updated
 */

const fs = require("fs");
const path = require("path");
const db = require("../config/db");

async function runMigration() {
  const connection = await db.getConnection();

  try {
    console.log("Starting shipping details migration...");

    // Read SQL file
    const sqlFilePath = path.join(
      __dirname,
      "shipping_details_implementation.sql"
    );
    const sqlContent = fs.readFileSync(sqlFilePath, "utf8");

    // Split SQL statements by delimiter changes and semicolons
    const statements = [];
    let currentDelimiter = ";";
    let currentStatement = "";

    const lines = sqlContent.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check for delimiter changes
      if (line.startsWith("DELIMITER")) {
        if (currentStatement.trim()) {
          statements.push({
            statement: currentStatement.trim(),
            delimiter: currentDelimiter,
          });
          currentStatement = "";
        }

        currentDelimiter = line.split(" ")[1];
        continue;
      }

      // Add line to current statement
      currentStatement += line + "\n";

      // Check if statement is complete
      if (line.endsWith(currentDelimiter)) {
        // Remove delimiter from the end of the statement
        if (currentDelimiter !== ";") {
          currentStatement =
            currentStatement.substring(
              0,
              currentStatement.length - currentDelimiter.length
            ) + ";";
        }

        statements.push({
          statement: currentStatement.trim(),
          delimiter: currentDelimiter,
        });
        currentStatement = "";
      }
    }

    // Execute each statement
    for (const { statement } of statements) {
      if (statement && !statement.startsWith("--")) {
        await connection.query(statement);
        console.log("Executed SQL statement successfully");
      }
    }

    // Call the migration procedure
    console.log("Running migration of existing shipping addresses...");
    await connection.query("CALL migrate_shipping_addresses()");

    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    connection.release();
  }
}

// Run the migration if this script is executed directly
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log("Migration script finished");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Migration script failed:", err);
      process.exit(1);
    });
}

module.exports = { runMigration };
