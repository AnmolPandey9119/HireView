# ============================================================
# Migration: add `profile_picture` column to users table
# File: migrate_add_profile_picture.py
#
# Works against whatever DATABASE_URL is configured (SQLite or
# Postgres/Neon) — unlike migrate_add_is_verified.py which was
# SQLite-only. Safe to run multiple times; it checks first.
#
# Run it:
#   python migrate_add_profile_picture.py
# ============================================================

from sqlalchemy import inspect, text

import config
from models.database import engine


def migrate():
    inspector = inspect(engine)
    columns = [col["name"] for col in inspector.get_columns("users")]

    if "profile_picture" in columns:
        print("profile_picture column already exists - nothing to do.")
        return

    print(f"Adding profile_picture column to users table ({config.DATABASE_URL.split('://')[0]})...")
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN profile_picture TEXT"))

    print("Migration complete.")


if __name__ == "__main__":
    migrate()