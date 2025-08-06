const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const INPUT_CSV = path.join(
  __dirname,
  "../../NV Coverage File 1-10-25 (1).csv"
);

// List the columns you want to extract
const COLUMNS = [
  "barangay_name",
  "municipality_name",
  "province_name",
  "matcher",
  "Zone Name",
  "Status",
];

const OUTPUT_JSON = path.join(__dirname, "nv_coverage_filtered.json");

const results = [];

fs.createReadStream(INPUT_CSV)
  .pipe(csv())
  .on("data", (row) => {
    const filtered = {};
    COLUMNS.forEach((col) => {
      filtered[col] = row[col];
    });
    results.push(filtered);
  })
  .on("end", () => {
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, 2), "utf8");
    console.log(`CSV parsing complete. Output saved to ${OUTPUT_JSON}`);
  });
