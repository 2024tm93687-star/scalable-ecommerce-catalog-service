import csv
import os
from decimal import Decimal
from typing import Optional

from fastapi import Body, HTTPException, Query
from pydantic import BaseModel, Field

from common.eci_common import banker_round, create_service_app, get_db, rows_to_dicts


SERVICE_NAME = "catalog-service"
DB_PATH = os.getenv("DATABASE_PATH", "/tmp/eci/catalog/catalog.db")
SEED_DIR = os.getenv("SEED_DIR", "/app/data/eci-seed")

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS products (
    product_id INTEGER PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"""


class ProductIn(BaseModel):
    sku: str = Field(min_length=2, max_length=64)
    name: str = Field(min_length=2, max_length=255)
    category: str = Field(min_length=2, max_length=128)
    price: Decimal = Field(gt=0)
    is_active: bool = True


class ProductOut(ProductIn):
    product_id: int


app, logger, metrics = create_service_app(SERVICE_NAME)


def init_db() -> None:
    with get_db(DB_PATH) as conn:
        conn.executescript(SCHEMA_SQL)
        existing = conn.execute("SELECT COUNT(*) AS count FROM products").fetchone()["count"]
        if existing:
            return
        seed_file = os.path.join(SEED_DIR, "eci_products_indian.csv")
        if not os.path.exists(seed_file):
            return
        with open(seed_file, newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            conn.executemany(
                """
                INSERT INTO products(product_id, sku, name, category, price, is_active)
                VALUES(?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        int(row["product_id"]),
                        row["sku"],
                        row["name"],
                        row["category"],
                        str(banker_round(row["price"])),
                        1 if row["is_active"].lower() == "true" else 0,
                    )
                    for row in reader
                ],
            )


@app.on_event("startup")
def startup_event() -> None:
    init_db()


@app.get("/v1/products")
def list_products(
    search: Optional[str] = None,
    category: Optional[str] = None,
    is_active: Optional[bool] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    offset = (page - 1) * page_size
    query = "SELECT * FROM products WHERE 1=1"
    params = []
    if search:
        query += " AND (LOWER(name) LIKE ? OR LOWER(sku) LIKE ?)"
        token = f"%{search.lower()}%"
        params.extend([token, token])
    if category:
        query += " AND category = ?"
        params.append(category)
    if is_active is not None:
        query += " AND is_active = ?"
        params.append(1 if is_active else 0)
    with get_db(DB_PATH) as conn:
        total = conn.execute(f"SELECT COUNT(*) AS count FROM ({query})", params).fetchone()["count"]
        rows = conn.execute(query + " ORDER BY product_id LIMIT ? OFFSET ?", [*params, page_size, offset]).fetchall()
    items = rows_to_dicts(rows)
    for item in items:
        item["is_active"] = bool(item["is_active"])
    return {"page": page, "pageSize": page_size, "total": total, "items": items}


@app.get("/v1/products/{product_id}")
def get_product(product_id: int):
    with get_db(DB_PATH) as conn:
        row = conn.execute("SELECT * FROM products WHERE product_id = ?", (product_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "PRODUCT_NOT_FOUND", "message": "Product not found"})
    product = dict(row)
    product["is_active"] = bool(product["is_active"])
    return product


@app.get("/v1/products/by-sku/{sku}")
def get_product_by_sku(sku: str):
    with get_db(DB_PATH) as conn:
        row = conn.execute("SELECT * FROM products WHERE sku = ?", (sku,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "PRODUCT_NOT_FOUND", "message": "Product not found"})
    product = dict(row)
    product["is_active"] = bool(product["is_active"])
    return product


@app.post("/v1/products", status_code=201)
def create_product(payload: ProductIn = Body(...)):
    with get_db(DB_PATH) as conn:
        cursor = conn.execute(
            """
            INSERT INTO products(sku, name, category, price, is_active)
            VALUES(?, ?, ?, ?, ?)
            """,
            (payload.sku, payload.name, payload.category, str(banker_round(payload.price)), 1 if payload.is_active else 0),
        )
        product_id = cursor.lastrowid
        row = conn.execute("SELECT * FROM products WHERE product_id = ?", (product_id,)).fetchone()
    product = dict(row)
    product["is_active"] = bool(product["is_active"])
    return product


@app.put("/v1/products/{product_id}")
def update_product(product_id: int, payload: ProductIn = Body(...)):
    with get_db(DB_PATH) as conn:
        exists = conn.execute("SELECT product_id FROM products WHERE product_id = ?", (product_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail={"code": "PRODUCT_NOT_FOUND", "message": "Product not found"})
        conn.execute(
            """
            UPDATE products
            SET sku = ?, name = ?, category = ?, price = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
            WHERE product_id = ?
            """,
            (payload.sku, payload.name, payload.category, str(banker_round(payload.price)), 1 if payload.is_active else 0, product_id),
        )
        row = conn.execute("SELECT * FROM products WHERE product_id = ?", (product_id,)).fetchone()
    product = dict(row)
    product["is_active"] = bool(product["is_active"])
    return product


@app.delete("/v1/products/{product_id}", status_code=204)
def delete_product(product_id: int):
    with get_db(DB_PATH) as conn:
        deleted = conn.execute("DELETE FROM products WHERE product_id = ?", (product_id,)).rowcount
    if not deleted:
        raise HTTPException(status_code=404, detail={"code": "PRODUCT_NOT_FOUND", "message": "Product not found"})
    return None


@app.get("/v1/pricing/{sku}")
def get_pricing(sku: str, quantity: int = Query(1, ge=1)):
    with get_db(DB_PATH) as conn:
        row = conn.execute("SELECT * FROM products WHERE sku = ? AND is_active = 1", (sku,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "PRODUCT_NOT_FOUND", "message": "Active product not found"})
    unit_price = banker_round(row["price"])
    line_total = banker_round(unit_price * quantity)
    return {
        "product_id": row["product_id"],
        "sku": row["sku"],
        "name": row["name"],
        "category": row["category"],
        "unit_price": str(unit_price),
        "quantity": quantity,
        "line_total": str(line_total),
    }
