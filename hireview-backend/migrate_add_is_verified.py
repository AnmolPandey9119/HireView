import sqlite3
import config

def migrate():
    conn = sqlite3.connect(config.DATABASE_PATH)
    cur = conn.cursor()

    cur.execute("PRAGMA table_info(users)")
    existing_columns = [row[1] for row in cur.fetchall()]

    if "is_verified" in existing_columns:
        print("is_verified column already exists - nothing to do.")
        conn.close()
        return

    print("Adding is_verified column to users table...")
    cur.execute("ALTER TABLE users ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT 0")
    conn.commit()

    answer = input("Mark ALL existing users as verified so they can still log in? [y/N]: ").strip().lower()
    if answer == "y":
        cur.execute("UPDATE users SET is_verified = 1")
        conn.commit()
        print(f"Marked {cur.rowcount} existing user(s) as verified.")
    else:
        print("Skipped - existing users will need to verify via OTP before password login works.")

    conn.close()
    print("Migration complete.")

if __name__ == "__main__":
    migrate()
