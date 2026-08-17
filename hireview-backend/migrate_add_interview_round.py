# ============================================================
# Migration: add interview_round column to interviews table
# File: migrate_add_interview_round.py
#
# Part of the Technical / HR / Mixed round-selection feature
# (private sector only). Lets a candidate choose which round
# type they want to face; defaults to 'mixed' so old rows and
# any request that doesn't send this field keep the original,
# already-tested behavior.
#
# Works against whatever DATABASE_URL is configured (SQLite or
# Postgres/Neon). Safe to run multiple times; it checks first.
#
# Run it (same pattern as migrate_add_target_company.py):
#   python migrate_add_interview_round.py
#
# For the production DB, run it either from the Render Shell,
# or locally with the production DATABASE_URL passed in for
# just that one command, e.g.:
#   DATABASE_URL="<paste prod connection string>" python migrate_add_interview_round.py
# ============================================================

from sqlalchemy import inspect, text  # pyright: ignore[reportMissingImports]

import config
from models.database import engine


def migrate():
    inspector = inspect(engine)
    columns = [col["name"] for col in inspector.get_columns("interviews")]
    db_kind = config.DATABASE_URL.split("://")[0]

    with engine.begin() as conn:
        if "interview_round" not in columns:
            print(f"Adding interview_round column ({db_kind})...")
            conn.execute(text("ALTER TABLE interviews ADD COLUMN interview_round VARCHAR DEFAULT 'mixed'"))
        else:
            print("interview_round already exists - skipping.")

    print("Migration complete.")


if __name__ == "__main__":
    migrate()