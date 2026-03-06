-- ==========================================================
-- HOSTEL HUB - ADVANCED DBMS SCHEMA WITH CONSTRAINTS
-- Dialect: MySQL
-- ==========================================================

-- NOTE: MySQL does not have DOMAINS or EXTENSIONS like PostgreSQL.
-- We use standard types and constraints.

-- 1. DDL: DATABASE STRUCTURE
-- Using NAMED CONSTRAINTS where possible for professional error reporting

-- Cleanup
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS fee_structure;
DROP TABLE IF EXISTS complaints;
DROP TABLE IF EXISTS attendance;
DROP TABLE IF EXISTS notices;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS rooms;
DROP VIEW IF EXISTS view_defaulters;
DROP VIEW IF EXISTS view_financial_status;
DROP VIEW IF EXISTS view_room_occupancy;
SET FOREIGN_KEY_CHECKS = 1;

-- Rooms Table
CREATE TABLE rooms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_number VARCHAR(10) NOT NULL,
    room_type VARCHAR(50) DEFAULT 'Standard',
    capacity INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- NAMED CONSTRAINTS
    CONSTRAINT uk_room_number UNIQUE(room_number),
    CONSTRAINT chk_positive_capacity CHECK (capacity > 0 AND capacity <= 10), -- Business Rule: Max 10 per room
    CONSTRAINT chk_room_type CHECK (room_type IN ('Single-Deluxe', 'Double-Standard', 'Triple-Budget', 'Single-Premium', 'Standard'))
) ENGINE=InnoDB;

-- Students (Residents) Table
CREATE TABLE students (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL, -- MySQL uses VARCHAR instead of custom domain
    room_id INT,
    registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- NAMED CONSTRAINTS
    CONSTRAINT uk_student_email UNIQUE(email),
    CONSTRAINT fk_student_room FOREIGN KEY (room_id) 
        REFERENCES rooms(id) 
        ON DELETE SET NULL 
        ON UPDATE CASCADE,
    CONSTRAINT chk_name_length CHECK (length(trim(name)) >= 2),
    -- Manual email check since Domains don't exist in MySQL
    CONSTRAINT chk_email_format CHECK (email LIKE '%_@__%.__%')
) ENGINE=InnoDB;

-- Attendance Table
CREATE TABLE attendance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    attendance_date DATE NOT NULL, -- MySQL CURRENT_DATE needs to be handled in logic or default
    is_present BOOLEAN DEFAULT FALSE,
    
    -- NAMED CONSTRAINTS
    CONSTRAINT fk_attendance_student FOREIGN KEY (student_id) 
        REFERENCES students(id) 
        ON DELETE CASCADE,
    CONSTRAINT uk_student_daily_attendance UNIQUE(student_id, attendance_date)
) ENGINE=InnoDB;

-- Complaints Table
CREATE TABLE complaints (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL DEFAULT NULL,
    
    -- NAMED CONSTRAINTS
    CONSTRAINT fk_complaint_student FOREIGN KEY (student_id) 
        REFERENCES students(id) 
        ON DELETE CASCADE,
    CONSTRAINT chk_complaint_status CHECK (status IN ('Pending', 'In-Progress', 'Resolved'))
) ENGINE=InnoDB;

-- Notices Table
CREATE TABLE notices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    notice_text TEXT NOT NULL,
    priority VARCHAR(10) DEFAULT 'Normal',
    posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL DEFAULT NULL,
    
    CONSTRAINT chk_priority CHECK (priority IN ('Low', 'Normal', 'High', 'Urgent'))
) ENGINE=InnoDB;

-- Audit Logs for System Tracking
CREATE TABLE audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    event_action VARCHAR(50) NOT NULL,
    target_table VARCHAR(50) NOT NULL,
    event_details JSON, -- MySQL 5.7+ supports JSON
    severity INT DEFAULT 1 CHECK (severity BETWEEN 1 AND 5)
) ENGINE=InnoDB;

-- Fee Structure Table (Base Rates)
CREATE TABLE fee_structure (
    room_type VARCHAR(50) PRIMARY KEY,
    monthly_fee DECIMAL(10, 2) NOT NULL CHECK (monthly_fee >= 0),
    amenity_fee DECIMAL(10, 2) DEFAULT 0.00
) ENGINE=InnoDB;

-- Payments Table (Transaction Log)
CREATE TABLE payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL CHECK (amount > 0),
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    payment_method VARCHAR(20),
    transaction_id VARCHAR(50) UNIQUE,
    
    CONSTRAINT fk_payment_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    CONSTRAINT chk_pay_method CHECK (payment_method IN ('Cash', 'UPI', 'Card', 'Bank Transfer'))
) ENGINE=InnoDB;

-- Financial Views
CREATE VIEW view_financial_status AS
SELECT 
    s.id AS student_id,
    s.name,
    fs.monthly_fee AS total_due,
    COALESCE((SELECT SUM(amount) FROM payments WHERE student_id = s.id), 0) AS total_paid,
    (fs.monthly_fee - COALESCE((SELECT SUM(amount) FROM payments WHERE student_id = s.id), 0)) AS balance
FROM students s
LEFT JOIN rooms r ON s.room_id = r.id
LEFT JOIN fee_structure fs ON r.room_type = fs.room_type;

CREATE VIEW view_defaulters AS
SELECT * FROM view_financial_status WHERE balance > 0;

CREATE VIEW view_room_occupancy AS
SELECT 
    r.id AS room_id,
    r.room_number,
    r.capacity,
    (SELECT COUNT(*) FROM students WHERE room_id = r.id) AS current_occupants,
    (r.capacity - (SELECT COUNT(*) FROM students WHERE room_id = r.id)) AS vacancies,
    CASE 
        WHEN (SELECT COUNT(*) FROM students WHERE room_id = r.id) >= r.capacity THEN 'FULL'
        ELSE 'AVAILABLE'
    END AS status
FROM rooms r;

-- ==========================================================
-- 3. TRIGGERS (FOR AUDIT & ASSERTIONS)
-- ==========================================================

DELIMITER //

-- Audit Trigger for Students (Insert)
CREATE TRIGGER trg_audit_students_insert 
AFTER INSERT ON students 
FOR EACH ROW 
BEGIN
    INSERT INTO audit_logs (event_action, target_table, event_details)
    VALUES ('INSERT', 'students', JSON_OBJECT('id', NEW.id, 'name', NEW.name, 'email', NEW.email));
END //

-- Capacity Assertion Trigger
CREATE TRIGGER trg_verify_capacity_insert
BEFORE INSERT ON students
FOR EACH ROW
BEGIN
    DECLARE curr_count INT;
    DECLARE max_cap INT;
    IF NEW.room_id IS NOT NULL THEN
        SELECT COUNT(*) INTO curr_count FROM students WHERE room_id = NEW.room_id;
        SELECT capacity INTO max_cap FROM rooms WHERE id = NEW.room_id;
        IF curr_count >= max_cap THEN
            SIGNAL SQLSTATE '45000' 
            SET MESSAGE_TEXT = 'DB_ASSERTION_ERROR: Room is currently at full capacity';
        END IF;
    END IF;
END //

DELIMITER ;

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
