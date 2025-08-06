const fs = require("fs");
const path = require("path");
const db = require("../config/db");

async function runMigration() {
  const connection = await db.getConnection();

  try {
    console.log("Starting shipping columns migration...");

    // Read SQL file
    const sqlFilePath = path.join(
      __dirname,
      "..",
      "migrations",
      "add_shipping_columns.sql"
    );
    const sqlContent = fs.readFileSync(sqlFilePath, "utf8");

    // Split SQL statements by semicolons
    const statements = sqlContent.split(";").filter((stmt) => stmt.trim());

    // Execute each statement
    for (const statement of statements) {
      if (statement.trim()) {
        await connection.query(statement);
        console.log("Executed SQL statement successfully");
      }
    }

    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    connection.release();
  }
}

// Run the migration
runMigration()
  .then(() => {
    console.log("Migration completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
