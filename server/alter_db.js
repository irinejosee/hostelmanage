import db from './db.js';

async function alterTable() {
    try {
        await db.query('ALTER TABLE students ADD COLUMN phone VARCHAR(15) AFTER email');
        console.log('✅ Added phone column to students table');
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log('⚠️ Phone column already exists');
        } else {
            console.error('❌ Alter table failed:', e.message);
        }
    } finally {
        process.exit();
    }
}

alterTable();
