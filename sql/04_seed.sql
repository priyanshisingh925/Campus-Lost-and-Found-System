-- ============================================================
-- Campus Lost & Found — Seed / Demo Data
-- Run AFTER 01_schema.sql and 02_programmability.sql.
-- Admin passwords are set by npm run setup (bcrypt of 'admin123').
-- ============================================================

USE campus_lost_found;

-- Admin users
INSERT INTO users (name, email, phone, role) VALUES
('Admin Office',   'admin@campus.edu',    '9000000001', 'ADMIN'),
('Security Desk',  'security@campus.edu', '9000000002', 'ADMIN');

-- Students
INSERT INTO users (name, email, phone, role) VALUES
('Rahul Sharma',   'rahul@email.com',    '9876543210', 'STUDENT'),
('Arjun Mehta',    'arjun@email.com',    '9876543211', 'STUDENT'),
('Priya Nair',     'priya@email.com',    '9876543212', 'STUDENT'),
('Sneha Kulkarni', 'sneha@email.com',    '9876543213', 'STUDENT'),
('Vikram Singh',   'vikram@email.com',   '9876543214', 'STUDENT'),
('Ananya Rao',     'ananya@email.com',   '9876543215', 'STUDENT'),
('Karan Patel',    'karan@email.com',    '9876543216', 'STUDENT'),
('Divya Iyer',     'divya@email.com',    '9876543217', 'STUDENT');

-- Locations
INSERT INTO locations (location_name) VALUES
('Library'), ('Canteen'), ('Block A'), ('Block B'), ('Parking'),
('Lab 302'), ('Hostel'), ('Sports Ground'), ('Auditorium'), ('Main Gate');

-- ------------------------------------------------------------
-- Items + reports
-- ------------------------------------------------------------
INSERT INTO items (item_name, category, description, color, brand)
VALUES ('Samsung Galaxy Watch', 'Electronics',
        'Black smartwatch with a small scratch near the screen', 'Black', 'Samsung');
SET @it_watch := LAST_INSERT_ID();

INSERT INTO lost_reports (user_id, item_id, location_id, lost_date, lost_time)
VALUES ((SELECT user_id FROM users WHERE email='rahul@email.com'),
        @it_watch, (SELECT location_id FROM locations WHERE location_name='Library'),
        '2026-09-10', '16:30:00');

INSERT INTO items (item_name, category, description, color, brand)
VALUES ('Samsung Galaxy Watch', 'Electronics',
        'Black watch, scratch near screen, black strap', 'Black', 'Samsung');
SET @it_watch2 := LAST_INSERT_ID();

INSERT INTO found_reports (user_id, item_id, location_id, found_date, found_time, source)
VALUES ((SELECT user_id FROM users WHERE email='arjun@email.com'),
        @it_watch2, (SELECT location_id FROM locations WHERE location_name='Library'),
        '2026-09-10', '17:45:00', 'USER');

-- ---- Wallet pair (partial match: different brand, near dates) ----
INSERT INTO items (item_name, category, description, color, brand)
VALUES ('Black Wallet', 'Wallet', 'Bi-fold leather wallet with college ID inside', 'Black', NULL);
SET @it_wallet := LAST_INSERT_ID();

INSERT INTO lost_reports (user_id, item_id, location_id, lost_date, lost_time)
VALUES ((SELECT user_id FROM users WHERE email='priya@email.com'),
        @it_wallet, (SELECT location_id FROM locations WHERE location_name='Canteen'),
        '2026-09-11', '13:15:00');

INSERT INTO items (item_name, category, description, color, brand)
VALUES ('Brown Wallet', 'Wallet', 'Brown leather wallet found near the till', 'Brown', NULL);
SET @it_wallet2 := LAST_INSERT_ID();

INSERT INTO found_reports (user_id, item_id, location_id, found_date, found_time, source)
VALUES ((SELECT user_id FROM users WHERE email='karan@email.com'),
        @it_wallet2, (SELECT location_id FROM locations WHERE location_name='Canteen'),
        '2026-09-11', '14:00:00', 'BOX');

-- ---- Blue bottle (high score, same everything) ----
INSERT INTO items (item_name, category, description, color, brand)
VALUES ('Blue Water Bottle', 'Bottle', 'Steel blue bottle with college logo sticker', 'Blue', 'Milton');
SET @it_bottle := LAST_INSERT_ID();

INSERT INTO lost_reports (user_id, item_id, location_id, lost_date, lost_time)
VALUES ((SELECT user_id FROM users WHERE email='sneha@email.com'),
        @it_bottle, (SELECT location_id FROM locations WHERE location_name='Sports Ground'),
        '2026-09-12', '09:00:00');

INSERT INTO items (item_name, category, description, color, brand)
VALUES ('Blue Water Bottle', 'Bottle', 'Blue steel bottle with logo, dents on base', 'Blue', 'Milton');
SET @it_bottle2 := LAST_INSERT_ID();

INSERT INTO found_reports (user_id, item_id, location_id, found_date, found_time, source)
VALUES ((SELECT user_id FROM users WHERE email='vikram@email.com'),
        @it_bottle2, (SELECT location_id FROM locations WHERE location_name='Sports Ground'),
        '2026-09-12', '11:30:00', 'USER');

-- ---- Unmatched found: admin entered from the physical box (source BOX) ----
INSERT INTO items (item_name, category, description, color, brand)
VALUES ('Physics Textbook', 'Book', 'HC Verma Concepts of Physics part 1, name page torn', 'Blue', NULL);
SET @it_book := LAST_INSERT_ID();

INSERT INTO found_reports (user_id, item_id, location_id, found_date, found_time, source)
VALUES ((SELECT user_id FROM users WHERE email='admin@campus.edu'),
        @it_book, (SELECT location_id FROM locations WHERE location_name='Library'),
        '2026-09-13', '10:00:00', 'BOX');

-- ---- Unmatched lost: earphones lost in hostel ----
INSERT INTO items (item_name, category, description, color, brand)
VALUES ('Wireless Earphones', 'Electronics', 'White TWS earbuds in round charging case', 'White', 'boAt');
SET @it_buds := LAST_INSERT_ID();

INSERT INTO lost_reports (user_id, item_id, location_id, lost_date, lost_time)
VALUES ((SELECT user_id FROM users WHERE email='divya@email.com'),
        @it_buds, (SELECT location_id FROM locations WHERE location_name='Hostel'),
        '2026-09-14', '21:00:00');

-- ---- Distraction row so matching is not trivially 100% everywhere ----
INSERT INTO items (item_name, category, description, color, brand)
VALUES ('Black Umbrella', 'Accessories', 'Folding umbrella, black, wooden handle', 'Black', NULL);
SET @it_umb := LAST_INSERT_ID();

INSERT INTO found_reports (user_id, item_id, location_id, found_date, found_time, source)
VALUES ((SELECT user_id FROM users WHERE email='ananya@email.com'),
        @it_umb, (SELECT location_id FROM locations WHERE location_name='Main Gate'),
        '2026-09-13', '18:20:00', 'BOX');
