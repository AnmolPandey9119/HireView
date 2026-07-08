# ============================================================
# Run this LOCALLY (never on a public server) to generate the
# value you'll paste into Render's ADMIN_PASSWORD_HASH env var.
#
# Usage:
#   cd hireview-backend
#   python generate_admin_hash.py
#
# Note: the password is typed visibly (not hidden) — some
# terminals (including VS Code's integrated terminal on Windows)
# don't handle hidden input reliably. This only runs locally and
# only the resulting hash goes anywhere, so it's fine.
# ============================================================

import bcrypt

password = input("Choose an admin password: ")
confirm = input("Confirm password: ")

if password != confirm:
    print("Passwords don't match. Run the script again.")
else:
    hashed = bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")
    print("\nAdd these two environment variables in Render:\n")
    print(f"ADMIN_USERNAME=choose-a-username")
    print(f"ADMIN_PASSWORD_HASH={hashed}")