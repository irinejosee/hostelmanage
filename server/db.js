import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

/**
 * HOSTEL HUB - DATABASE CONNECTION (MySQL)
 * This file establishes a connection pool to the MySQL database
 * using credentials from the .env file.
 */

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'mysqlmaggie@1234',
    database: process.env.DB_NAME || 'hostelmanagedb',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test the connection
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Successfully connected to MySQL database.');
        connection.release();
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
    }
}

testConnection();

export default pool;
