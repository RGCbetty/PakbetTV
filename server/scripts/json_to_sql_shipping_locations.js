const fs = require("fs");
const path = require("path");

const INPUT_JSON = path.join(__dirname, "nv_coverage_filtered.json");
const TABLE_NAME = "Shipping_Locations_Ninjavan";
const COLUMNS = [
  "barangay_name",
  "municipality_name",
  "province_name",
  "matcher",
  "Zone Name",
  "Status",
];

// Helper to escape single quotes and handle nulls
function sqlEscape(value) {
  if (value === null || value === undefined) return "NULL";
  return "'" + String(value).replace(/'/g, "''") + "'";
}

// Read the single JSON file
const data = JSON.parse(fs.readFileSync(INPUT_JSON, "utf8"));
const total = data.length;
const chunkSize = Math.ceil(total / 3);

for (let i = 0; i < 3; i++) {
  const chunk = data.slice(i * chunkSize, (i + 1) * chunkSize);
  const outputFile = path.join(
    __dirname,
    `shipping_locations_ninjavan_${i + 1}.sql`
  );
  let sql = `INSERT INTO ${TABLE_NAME} (${COLUMNS.map(
    (col) => `\`${col}\``
  ).join(", ")}) VALUES\n`;
  sql += chunk
    .map(
      (row) => "(" + COLUMNS.map((col) => sqlEscape(row[col])).join(", ") + ")"
    )
    .join(",\n");
  sql += chunk.length ? ";\n" : "";
  fs.writeFileSync(outputFile, sql, "utf8");
  console.log(`SQL file generated: ${outputFile}`);
}
