import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import db from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('🏠 Hostel Hub API is running...');
});

// --- SYNC ENDPOINTS ---

// 1. Rooms Sync
app.post('/api/rooms', async (req, res) => {
    const data = Array.isArray(req.body) ? req.body : [req.body];
    try {
        const details = [];
        for (const room of data) {
            const [existing] = await db.query('SELECT id FROM rooms WHERE room_number = ?', [room.number || room.room_number]);
            if (existing.length > 0) {
                await db.query('UPDATE rooms SET room_type = ?, capacity = ? WHERE room_number = ?',
                    [room.type || room.room_type, room.capacity, room.number || room.room_number]);
                details.push({ number: room.number, id: existing[0].id });
            } else {
                const [result] = await db.query('INSERT INTO rooms (room_number, room_type, capacity) VALUES (?, ?, ?)',
                    [room.number || room.room_number, room.type || room.room_type, room.capacity]);
                details.push({ number: room.number, id: result.insertId });
            }
        }
        res.json({ success: true, details });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. Students Sync
app.post('/api/students', async (req, res) => {
    const data = Array.isArray(req.body) ? req.body : [req.body];
    try {
        const details = [];
        for (const s of data) {
            const roomId = s.room_id || s.roomId || null;
            const [existing] = await db.query('SELECT id FROM students WHERE email = ?', [s.email]);
            if (existing.length > 0) {
                await db.query('UPDATE students SET name = ?, room_id = ? WHERE email = ?', [s.name, roomId, s.email]);
                details.push({ email: s.email, id: existing[0].id });
            } else {
                const [result] = await db.query('INSERT INTO students (name, email, room_id) VALUES (?, ?, ?)', [s.name, s.email, roomId]);
                details.push({ email: s.email, id: result.insertId });
            }
        }
        res.json({ success: true, details });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Attendance Sync
app.post('/api/attendance', async (req, res) => {
    const data = Array.isArray(req.body) ? req.body : [req.body];
    try {
        for (const att of data) {
            const date = att.attendance_date || att.date;
            const isPresent = att.is_present !== undefined ? att.is_present : true;
            await db.query('INSERT INTO attendance (student_id, attendance_date, is_present) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE is_present = ?',
                [att.studentId || att.student_id, date, isPresent, isPresent]);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Complaints Update/Sync
app.post('/api/complaints', async (req, res) => {
    const data = Array.isArray(req.body) ? req.body : [req.body];
    try {
        const details = [];
        for (const c of data) {
            if (c.id) {
                // Update existing
                await db.query('UPDATE complaints SET status = ?, resolved_at = ? WHERE id = ?',
                    [c.status, c.resolvedAt ? new Date(c.resolvedAt) : null, c.id]);
                details.push({ id: c.id });
            } else {
                // Insert new
                const [result] = await db.query('INSERT INTO complaints (student_id, title, description, status) VALUES (?, ?, ?, ?)',
                    [c.studentId || c.student_id, c.title, c.message || c.description, c.status || 'Pending']);
                details.push({ id: result.insertId });
            }
        }
        res.json({ success: true, details });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. Notices Sync (with Upsert)
app.post('/api/notices', async (req, res) => {
    const data = Array.isArray(req.body) ? req.body : [req.body];
    try {
        const details = [];
        for (const n of data) {
            const [result] = await db.query('INSERT INTO notices (id, notice_text, priority) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE notice_text = ?, priority = ?',
                [n.id || null, n.text || n.notice_text, n.priority || 'Normal', n.text || n.notice_text, n.priority || 'Normal']);
            details.push({ id: n.id || result.insertId });
        }
        res.json({ success: true, details });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 6. Payments Sync
app.post('/api/payments', async (req, res) => {
    const data = Array.isArray(req.body) ? req.body : [req.body];
    try {
        const details = [];
        for (const p of data) {
            const [result] = await db.query('INSERT INTO payments (student_id, amount, payment_method) VALUES (?, ?, ?)',
                [p.studentId || p.student_id, p.amount, p.method || p.payment_method]);
            details.push({ id: result.insertId });
        }
        res.json({ success: true, details });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 7. Audit Logs Sync
app.post('/api/logs', async (req, res) => {
    const data = Array.isArray(req.body) ? req.body : [req.body];
    try {
        for (const l of data) {
            await db.query('INSERT INTO audit_logs (event_action, target_table, event_details) VALUES (?, ?, ?)',
                [l.action, l.table, JSON.stringify(l.details)]);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 8. Fee Structure Sync
app.post('/api/fees', async (req, res) => {
    const data = Array.isArray(req.body) ? req.body : [req.body];
    try {
        for (const f of data) {
            await db.query('INSERT INTO fee_structure (room_type, monthly_fee) VALUES (?, ?) ON DUPLICATE KEY UPDATE monthly_fee = ?',
                [f.type || f.room_type, f.amount || f.monthly_fee, f.amount || f.monthly_fee]);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- DELETE ENDPOINTS ---

app.delete('/api/students/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM students WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/rooms/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM rooms WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/notices/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM notices WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- FETCH ENDPOINTS ---

app.get('/api/stats', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM view_room_occupancy');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/finances', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM view_financial_status');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/students', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT s.*, r.room_number FROM students s LEFT JOIN rooms r ON s.room_id = r.id');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/rooms', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM rooms');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/attendance', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT id, student_id, DATE_FORMAT(attendance_date, '%Y-%m-%d') as attendance_date, is_present FROM attendance");
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/complaints', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT c.*, s.name as student_name FROM complaints c LEFT JOIN students s ON c.student_id = s.id');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/notices', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM notices ORDER BY posted_at DESC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/payments', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT p.*, s.name as student_name FROM payments p JOIN students s ON p.student_id = s.id');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/logs', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM audit_logs');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/fees', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM fee_structure');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});