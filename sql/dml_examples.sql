

INSERT INTO students (name, email, room_id) 
VALUES ('Sarah Connor', 'sarah@skynet.com', 2);

 
INSERT INTO attendance (student_id, attendance_date, is_present)
SELECT id, CURRENT_DATE, TRUE FROM students WHERE name = 'Alice Johnson';

-- 3. DML: Update room type
UPDATE rooms SET room_type = 'Executive Suite' WHERE room_number = '101';

 
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
