-- ==========================================================
-- DML & DCL EXAMPLES (Data Manipulation & Control)
-- ==========================================================

-- 1. DML: Insert a new student and assign to a room
INSERT INTO students (name, email, room_id) 
VALUES ('Sarah Connor', 'sarah@skynet.com', 2);

-- 2. DML: Record attendance for today
INSERT INTO attendance (student_id, attendance_date, is_present)
SELECT id, CURRENT_DATE, TRUE FROM students WHERE name = 'Alice Johnson';

-- 3. DML: Update room type
UPDATE rooms SET room_type = 'Executive Suite' WHERE room_number = '101';

-- 4. Testing the TRIGGER / ASSERTION (This should FAIL if room 101 is full)
-- Alice is already in 101 (capacity 1). Trying to add another will trigger the assertion.
-- INSERT INTO students (name, email, room_id) VALUES ('John McClane', 'john@diehard.com', 1);

-- 5. DML: Resolve a complaint
UPDATE complaints 
SET status = 'Resolved' 
WHERE title = 'Water Leakage'; 
-- Observe how 'resolved_at' is auto-filled by the trigger.

-- 6. DCL: Role Creation and Granting
-- CREATE ROLE manager;
-- GRANT SELECT, INSERT, UPDATE ON students TO manager;
-- GRANT ALL PRIVILEGES ON rooms TO manager;

-- 7. Advanced Query using the View
SELECT * FROM view_room_occupancy WHERE status = 'AVAILABLE';

-- 8. Complex Join for Attendance Report
SELECT 
    s.name, 
    attend.attendance_date, 
    attend.is_present
FROM students s
JOIN attendance attend ON s.id = attend.student_id
ORDER BY attend.attendance_date DESC;
