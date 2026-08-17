# ============================================================
# Migration: add target_company column to interviews table
# File: migrate_add_target_company.py
#
# Part of the "Target Company" feature — an optional field
# (private sector only) letting the candidate name the company
# they're prepping for, so Arjun can shape his question style
# to match that company's real interview patterns without ever
# naming the company out loud during the interview.
#
# Works against whatever DATABASE_URL is configured (SQLite or
# Postgres/Neon). Safe to run multiple times; it checks first.
#
# Run it:
#   python migrate_add_target_company.py
# ============================================================

from sqlalchemy import inspect, text  # pyright: ignore[reportMissingImports]

import config
from models.database import engine


def migrate():
    inspector = inspect(engine)
    columns = [col["name"] for col in inspector.get_columns("interviews")]
    db_kind = config.DATABASE_URL.split("://")[0]

    with engine.begin() as conn:
        if "target_company" not in columns:
            print(f"Adding target_company column ({db_kind})...")
            conn.execute(text("ALTER TABLE interviews ADD COLUMN target_company VARCHAR"))
        else:
            print("target_company already exists - skipping.")

    print("Migration complete.")


if __name__ == "__main__":
    migrate()