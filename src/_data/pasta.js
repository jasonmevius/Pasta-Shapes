const fs = require("fs");
const path = require("path");
const Papa = require("papaparse");

module.exports = () => {
  const csvPath = path.join(__dirname, "pasta.csv");
  const csv = fs.readFileSync(csvPath, "utf8");

  const parsed = Papa.parse(csv, {
    header: true,
    skipEmptyLines: true
  });

  // If there are parse errors, surface a little signal in Netlify logs
  if (parsed.errors && parsed.errors.length) {
    console.warn("CSV parse errors (first 3):", parsed.errors.slice(0, 3));
  }

  return parsed.data;
};
