# ============================================================
# Migration: Normalize existing users' emails to canonical form
# File: migrate_normalize_emails.py
#
# Why this is needed: canonicalize_email() (in models/email_utils.py)
# strips Gmail's dots and "+tag" tricks going forward. But any account
# that registered BEFORE this fix may have its email stored exactly as
# typed — e.g. "Anmol.Pandey@gmail.com" instead of "anmolpandey@gmail.com".
# Without this migration, that user's login would stop matching once
# login also canonicalizes the entered email.
#
# Safety: if two existing rows would canonicalize to the SAME email
# (meaning the same person genuinely already has two separate accounts
# today), this script does NOT silently merge or delete anything — it
# skips that group and prints it for you to resolve by hand, then
# normalizes everything else.
#
# Uses SQLAlchemy (via models.database), so it works against whatever
# DATABASE_URL is configured — Postgres (Neon) in production, or local
# SQLite in dev — unlike the older migrate_*.py scripts in this repo
# which hardcode sqlite3.
#
# Run once, from hireview-backend/:
#   python migrate_normalize_emails.py
# ============================================================

from collections import defaultdict

from models.database import SessionLocal, User
from models.email_utils import canonicalize_email


def migrate():
    db = SessionLocal()
    try:
        users = db.query(User).all()

        groups = defaultdict(list)
        for u in users:
            groups[canonicalize_email(u.email)].append(u)

        updated = 0
        skipped_conflicts = []

        for canonical, group in groups.items():
            if len(group) > 1:
                # Same person's inbox is already split across multiple
                # accounts — don't guess which one should "win". Flag it.
                skipped_conflicts.append((canonical, [u.email for u in group]))
                continue

            user = group[0]
            if user.email != canonical:
                print(f"  {user.email}  ->  {canonical}")
                user.email = canonical
                updated += 1

        db.commit()

        print(f"\nNormalized {updated} existing user email(s).")

        if skipped_conflicts:
            print(f"\n⚠️  {len(skipped_conflicts)} email group(s) need manual review "
                  f"(multiple accounts already exist for the same real inbox):")
            for canonical, emails in skipped_conflicts:
                print(f"  {canonical}: {emails}")
            print("These were left untouched. Decide manually which account to keep "
                  "for each group before they can be safely merged.")

        print("\nMigration complete.")

    finally:
        db.close()


if __name__ == "__main__":
    migrate()