# ============================================================
# Migration: add subscription_plan + subscription_active_until
# columns to users table
# File: migrate_add_subscription_fields.py
#
# Part of the Weekly (₹99/7d) / Monthly (₹299/30d) subscription
# model — see "HireView Pricing Plan Proposal". No purchase
# endpoint exists yet; these columns just get the DB ready ahead
# of wiring a payment gateway.
#
# Works against whatever DATABASE_URL is configured (SQLite or
# Postgres/Neon). Safe to run multiple times; it checks first.
#
# Run it:
#   python migrate_add_subscription_fields.py
# ============================================================

from sqlalchemy import inspect, text

import config
from models.database import engine


def migrate():
    inspector = inspect(engine)
    columns = [col["name"] for col in inspector.get_columns("users")]
    db_kind = config.DATABASE_URL.split("://")[0]

    with engine.begin() as conn:
        if "subscription_plan" not in columns:
            print(f"Adding subscription_plan column ({db_kind})...")
            conn.execute(text("ALTER TABLE users ADD COLUMN subscription_plan VARCHAR"))
        else:
            print("subscription_plan already exists - skipping.")

        if "subscription_active_until" not in columns:
            print(f"Adding subscription_active_until column ({db_kind})...")
            conn.execute(text("ALTER TABLE users ADD COLUMN subscription_active_until TIMESTAMP"))
        else:
            print("subscription_active_until already exists - skipping.")

    print("Migration complete.")


if __name__ == "__main__":
    migrate()