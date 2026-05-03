require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { pool } = require('../src/db/pool');

function datasetPath() {
  return process.env.ECI_DATASET_DIR || path.resolve(__dirname, '..', 'data');
}

function loadCsv(fileName) {
  const filePath = path.join(datasetPath(), fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Dataset file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  });
}

async function seedProducts() {
  const rows = loadCsv('eci_products_indian.csv');

  for (const row of rows) {
    const sku = String(row.sku);
    const name = row.name || 'UNKNOWN_PRODUCT';
    const category = row.category || 'UNCATEGORIZED';
    const price = Number(row.price || 0);
    const isActive = String(row.is_active || 'true').toLowerCase() === 'true';

    await pool.query(
      `INSERT INTO products (product_id, sku, name, category, price, is_active, created_at, updated_at)
       VALUES (COALESCE($1, gen_random_uuid()::text), $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (sku) DO NOTHING`,
      [row.product_id || null, sku, name, category, price, isActive]
    );
  }

  console.log(`Seeded products rows processed: ${rows.length}`);
}

async function run() {
  try {
    await seedProducts();
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error('Catalog seed failed:', error.message);
  process.exit(1);
});
