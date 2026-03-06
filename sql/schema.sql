-- ==========================================================
-- HOSTEL HUB - ADVANCED DBMS SCHEMA WITH CONSTRAINTS
-- Dialect: PostgreSQL
-- ==========================================================

-- 0. EXTENSIONS & DOMAINS (Advanced DBMS Features)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Domain for Email Validation
-- Note: Simplified regex for demonstration
CREATE DOMAIN email_address AS TEXT
CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- 1. DDL: DATABASE STRUCTURE
-- Using NAMED CONSTRAINTS for professional error reporting

DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS fee_structure;
DROP VIEW IF EXISTS view_defaulters;
DROP VIEW IF EXISTS view_financial_status;
DROP VIEW IF EXISTS view_room_occupancy;

-- Rooms Table
CREATE TABLE rooms (
    id SERIAL PRIMARY KEY,
    room_number VARCHAR(10) NOT NULL,
    room_type VARCHAR(50) DEFAULT 'Standard',
    capacity INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- NAMED CONSTRAINTS
    CONSTRAINT uk_room_number UNIQUE(room_number),
    CONSTRAINT chk_positive_capacity CHECK (capacity > 0 AND capacity <= 10), -- Business Rule: Max 10 per room
    CONSTRAINT chk_room_type CHECK (room_type IN ('Single-Deluxe', 'Double-Standard', 'Triple-Budget', 'Single-Premium', 'Standard'))
);

-- Students (Residents) Table
CREATE TABLE students (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email email_address NOT NULL, -- Using the Domain defined above
    room_id INTEGER,
    registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- NAMED CONSTRAINTS
    CONSTRAINT uk_student_email UNIQUE(email),
    CONSTRAINT fk_student_room FOREIGN KEY (room_id) 
        REFERENCES rooms(id) 
        ON DELETE SET NULL 
        ON UPDATE CASCADE,
    CONSTRAINT chk_name_length CHECK (length(trim(name)) >= 2)
);

-- Attendance Table
CREATE TABLE attendance (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL,
    attendance_date DATE DEFAULT CURRENT_DATE,
    is_present BOOLEAN DEFAULT FALSE,
    
    -- NAMED CONSTRAINTS
    CONSTRAINT fk_attendance_student FOREIGN KEY (student_id) 
        REFERENCES students(id) 
        ON DELETE CASCADE,
    CONSTRAINT uk_student_daily_attendance UNIQUE(student_id, attendance_date),
    CONSTRAINT chk_past_date CHECK (attendance_date <= CURRENT_DATE) -- Cannot mark future attendance
);

-- Complaints Table
CREATE TABLE complaints (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    
    -- NAMED CONSTRAINTS
    CONSTRAINT fk_complaint_student FOREIGN KEY (student_id) 
        REFERENCES students(id) 
        ON DELETE CASCADE,
    CONSTRAINT chk_complaint_status CHECK (status IN ('Pending', 'In-Progress', 'Resolved')),
    CONSTRAINT chk_resolution_date CHECK (resolved_at IS NULL OR resolved_at >= created_at) -- Timeline integrity
);

-- Notices Table
CREATE TABLE notices (
    id SERIAL PRIMARY KEY,
    notice_text TEXT NOT NULL,
    priority VARCHAR(10) DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High', 'Urgent')),
    posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    
    CONSTRAINT chk_notice_expiry CHECK (expires_at IS NULL OR expires_at > posted_at)
);

-- Audit Logs for System Tracking
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    event_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    event_action VARCHAR(50) NOT NULL,
    target_table VARCHAR(50) NOT NULL,
    event_details JSONB,
    severity INTEGER DEFAULT 1 CHECK (severity BETWEEN 1 AND 5)
);

-- Fee Structure Table (Base Rates)
CREATE TABLE fee_structure (
    room_type VARCHAR(50) PRIMARY KEY,
    monthly_fee DECIMAL(10, 2) NOT NULL CHECK (monthly_fee >= 0),
    amenity_fee DECIMAL(10, 2) DEFAULT 0.00
);

-- Payments Table (Transaction Log)
CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL,
    amount DECIMAL(10, 2) NOT NULL CHECK (amount > 0),
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    payment_method VARCHAR(20) CHECK (payment_method IN ('Cash', 'UPI', 'Card', 'Bank Transfer')),
    transaction_id VARCHAR(50) UNIQUE,
    
    CONSTRAINT fk_payment_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

-- Financial Views
CREATE VIEW view_financial_status AS
SELECT 
    s.id AS student_id,
    s.name,
    fs.monthly_fee AS total_due,
    COALESCE(SUM(p.amount), 0) AS total_paid,
    (fs.monthly_fee - COALESCE(SUM(p.amount), 0)) AS balance
FROM students s
LEFT JOIN rooms r ON s.room_id = r.id
LEFT JOIN fee_structure fs ON r.room_type = fs.room_type
LEFT JOIN payments p ON s.id = p.student_id
GROUP BY s.id, s.name, fs.monthly_fee;

CREATE VIEW view_defaulters AS
SELECT * FROM view_financial_status WHERE balance > 0;
SELECT 
    r.id AS room_id,
    r.room_number,
    r.capacity,
    COUNT(s.id) AS current_occupants,
    (r.capacity - COUNT(s.id)) AS vacancies,
    CASE 
        WHEN COUNT(s.id) >= r.capacity THEN 'FULL'
        ELSE 'AVAILABLE'
    END AS status
FROM rooms r
LEFT JOIN students s ON r.id = s.room_id
GROUP BY r.id, r.room_number, r.capacity;

-- ==========================================================
-- 3. TRIGGERS & PROCEDURES (FOR COMPLEX CONSTRAINTS / ASSERTIONS)
-- ==========================================================

-- Trigger for Audit Logging
CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_logs (event_action, target_table, event_details)
    VALUES (TG_OP, TG_TABLE_NAME, row_to_json(NEW)::jsonb);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_students AFTER INSERT OR UPDATE ON students FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- Assertion Constraint via Trigger: Check Capacity before assignment
CREATE OR REPLACE FUNCTION fn_check_room_capacity()
RETURNS TRIGGER AS $$
DECLARE
    curr_count INT;
    max_cap INT;
BEGIN
    IF NEW.room_id IS NOT NULL THEN
        SELECT COUNT(*) INTO curr_count FROM students WHERE room_id = NEW.room_id AND id != COALESCE(NEW.id, -1);
        SELECT capacity INTO max_cap FROM rooms WHERE id = NEW.room_id;
        
        IF curr_count >= max_cap THEN
            RAISE EXCEPTION 'DB_ASSERTION_ERROR: Room % is currently at full capacity (%)', 
                (SELECT room_number FROM rooms WHERE id = NEW.room_id), max_cap;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_verify_capacity
BEFORE INSERT OR UPDATE OF room_id ON students
FOR EACH ROW EXECUTE FUNCTION fn_check_room_capacity();

-- ==========================================================
-- 4. DML: SEED DATA
-- ==========================================================

INSERT INTO fee_structure (room_type, monthly_fee, amenity_fee) VALUES
('Single-Deluxe', 5000.00, 500.00),
('Double-Standard', 3500.00, 300.00),
('Triple-Budget', 2500.00, 200.00),
('Standard', 3000.00, 250.00);

INSERT INTO rooms (room_number, room_type, capacity) VALUES
('101', 'Single-Deluxe', 1),
('102', 'Double-Standard', 2),
('201', 'Triple-Budget', 3);

INSERT INTO students (name, email, room_id) VALUES
('Alice Johnson', 'alice@hostel.com', 1),
('Bob Smith', 'bob@hostel.com', 2);

-- ==========================================================
-- 5. DCL: DATA CONTROL
-- ==========================================================
-- GRANT SELECT ON view_room_occupancy TO public;

