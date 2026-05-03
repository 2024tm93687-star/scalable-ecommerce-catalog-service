const { randomUUID } = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { pricingResolveLatencyMs } = require('../metrics');

const router = express.Router();

function parsePagination(query) {
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || '10', 10), 1), 100);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

router.get('/', async (req, res, next) => {
  const { page, limit, offset } = parsePagination(req.query);
  const params = [];
  const filters = [];

  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    filters.push(`(name ILIKE $${params.length} OR category ILIKE $${params.length} OR sku ILIKE $${params.length})`);
  }
  if (req.query.category) {
    params.push(req.query.category);
    filters.push(`category = $${params.length}`);
  }
  if (typeof req.query.is_active !== 'undefined') {
    params.push(req.query.is_active === 'true');
    filters.push(`is_active = $${params.length}`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  try {
    const countQuery = `SELECT COUNT(*)::INT AS total FROM products ${whereClause}`;
    const dataQuery = `
      SELECT * FROM products
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const totalResult = await pool.query(countQuery, params);
    const dataResult = await pool.query(dataQuery, [...params, limit, offset]);

    return res.json({
      page,
      limit,
      total: totalResult.rows[0].total,
      items: dataResult.rows
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  const { sku, name, category, price, is_active } = req.body;
  if (!sku || !name || !category || typeof price === 'undefined') {
    return next({ status: 400, code: 'VALIDATION_ERROR', message: 'sku, name, category and price are required' });
  }

  try {
    const inserted = await pool.query(
      `INSERT INTO products (product_id, sku, name, category, price, is_active)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, true))
       RETURNING *`,
      [randomUUID(), sku, name, category, price, is_active]
    );
    return res.status(201).json(inserted.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return next({ status: 409, code: 'DUPLICATE_SKU', message: 'SKU already exists' });
    }
    return next(error);
  }
});

router.get('/:productId', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE product_id = $1', [req.params.productId]);
    if (!result.rows.length) {
      return next({ status: 404, code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.patch('/:productId', async (req, res, next) => {
  const { name, category, price, is_active } = req.body;
  if (
    typeof name === 'undefined' &&
    typeof category === 'undefined' &&
    typeof price === 'undefined' &&
    typeof is_active === 'undefined'
  ) {
    return next({ status: 400, code: 'VALIDATION_ERROR', message: 'At least one field must be provided' });
  }

  try {
    const updated = await pool.query(
      `UPDATE products
       SET name = COALESCE($1, name),
           category = COALESCE($2, category),
           price = COALESCE($3, price),
           is_active = COALESCE($4, is_active),
           updated_at = NOW()
       WHERE product_id = $5
       RETURNING *`,
      [name, category, price, is_active, req.params.productId]
    );

    if (!updated.rows.length) {
      return next({ status: 404, code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
    }
    return res.json(updated.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.delete('/:productId', async (req, res, next) => {
  try {
    const deleted = await pool.query(
      `UPDATE products
       SET is_active = false, updated_at = NOW()
       WHERE product_id = $1
       RETURNING product_id`,
      [req.params.productId]
    );

    if (!deleted.rows.length) {
      return next({ status: 404, code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
    }
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.post('/pricing/resolve', async (req, res, next) => {
  const endTimer = pricingResolveLatencyMs.startTimer();
  const items = req.body.items || [];

  if (!Array.isArray(items) || items.length === 0) {
    return next({ status: 400, code: 'VALIDATION_ERROR', message: 'items array is required' });
  }

  try {
    const resolvedItems = [];
    for (const item of items) {
      if (!item.sku) {
        return next({ status: 400, code: 'VALIDATION_ERROR', message: 'Each item requires sku' });
      }
      const product = await pool.query('SELECT * FROM products WHERE sku = $1', [item.sku]);
      if (!product.rows.length) {
        resolvedItems.push({ sku: item.sku, found: false });
      } else {
        resolvedItems.push({
          sku: item.sku,
          product_id: product.rows[0].product_id,
          unit_price: Number(product.rows[0].price),
          is_active: product.rows[0].is_active,
          found: true
        });
      }
    }
    return res.json({ items: resolvedItems });
  } catch (error) {
    return next(error);
  } finally {
    endTimer();
  }
});

module.exports = router;