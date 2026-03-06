# Hostel Hub - Relational Database Management System (RDBMS)

This directory contains the professional SQL implementation for the Hostel Hub database. While the application currently uses `LokiJS` for browser portability, this schema provides a production-grade relational structure.

## Database Components Implementation

### 1. DDL (Data Definition Language)
Found in `sql/schema.sql`. It defines the structure of:
- `rooms`, `students`, `attendance`, `complaints`, `notices`, and `audit_logs`.
- Includes **Primary Keys**, **Foreign Keys**, and **Check Constraints**.

### 2. DML (Data Manipulation Language)
The schema includes seed data to prepopulate the system with initial rooms, residents, and notices.

### 3. DCL (Data Control Language)
Permissions and role management sections are included (commented out as they require superuser access) to demonstrate:
- `hostel_admin`: Full system access.
- `hostel_resident`: Restricted access to personal info and notices.

### 4. Views (Abstraction)
Two powerful views are implemented:
- `view_room_occupancy`: Real-time calculation of available beds.
- `view_resident_details`: Flattened view joining students with their respective room information.

### 5. Triggers (Automation)
- `trg_after_student_delete`: Automatically logs resident removals into the `audit_logs`.
- `trg_before_complaint_update`: Automatically timestamps when a complaint status is changed to 'Resolved'.

### 6. Assertions (Integrity)
Since standard `ASSERTION` syntax is rarely supported in most RDBMS (like Postgres or MySQL), we have implemented a **Complex Assertion Trigger**:
- `trg_check_capacity`: This prevents a student from being inserted or updated into a room if that room has reached its capacity. It raises a custom SQL exception, ensuring data integrity at the database level.

---

## How to Use
You can run `sql/schema.sql` in any PostgreSQL-compatible environment (like pgAdmin, DBeaver, or a cloud instance) to generate the live database.
