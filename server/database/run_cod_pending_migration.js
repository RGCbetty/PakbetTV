const fs = require("fs");
const path = require("path");
const db = require("../config/db");

async function runMigration() {
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, "../migrations/add_cod_pending_status.sql"),
      "utf8"
    );

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // Split SQL into individual statements and execute each one
      const statements = sql
        .split(";")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);

      for (const statement of statements) {
        await connection.query(statement);
        console.log("Executed:", statement);
      }

      await connection.commit();
      console.log("Migration completed successfully");
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

runMigration();
