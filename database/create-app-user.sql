-- Recommended for production: run the app with its own MySQL user instead of root.
-- 1. Replace CHANGE_ME_STRONG_PASSWORD below.
-- 2. Run this in phpMyAdmin (SQL tab) or:  C:\xampp\mysql\bin\mysql.exe -u root -p < database\create-app-user.sql
-- 3. Put the same user and password in .env (DB_USER / DB_PASSWORD).
-- 4. Also set a password for the XAMPP root account (it is blank by default).

CREATE USER IF NOT EXISTS 'infinity_app'@'localhost' IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';
CREATE USER IF NOT EXISTS 'infinity_app'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';

-- Only data access. No DROP, ALTER, GRANT or FILE privileges.
GRANT SELECT, INSERT, UPDATE, DELETE ON infinity_ops.* TO 'infinity_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON infinity_ops.* TO 'infinity_app'@'127.0.0.1';
FLUSH PRIVILEGES;
