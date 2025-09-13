const mysql = require('mysql2/promise');
require('dotenv').config();

class Database {
    constructor() {
        this.pool = mysql.createPool({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
           
        });
    }

    async query(sql, params) {
        try {
            const [results] = await this.pool.execute(sql, params);
            return results;
        } catch (error) {
            console.error('Database query error:', error);
            throw error;
        }
    }

    async getConnection() {
        return await this.pool.getConnection();
    }

    async close() {
        await this.pool.end();
    }

    // CRUD Operations for orders
    async getAllOrders() {
        return await this.query('SELECT * FROM orders ORDER BY created_at DESC');
    }

    async getOrderById(id) {
        const result = await this.query('SELECT * FROM orders WHERE id = ?', [id]);
        return result[0];
    }

    async createOrder(customerName, productName, status = 'pending') {
        const result = await this.query(
            'INSERT INTO orders (customer_name, product_name, status) VALUES (?, ?, ?)',
            [customerName, productName, status]
        );
        return result.insertId;
    }

    async updateOrder(id, data) {
        const fields = [];
        const values = [];
        
        Object.entries(data).forEach(([key, value]) => {
            if (value !== undefined) {
                fields.push(`${key} = ?`);
                values.push(value);
            }
        });
        
        if (fields.length === 0) return false;
        
        values.push(id);
        const sql = `UPDATE orders SET ${fields.join(', ')} WHERE id = ?`;
        const result = await this.query(sql, values);
        return result.affectedRows > 0;
    }

    async deleteOrder(id) {
        const result = await this.query('DELETE FROM orders WHERE id = ?', [id]);
        return result.affectedRows > 0;
    }
}

module.exports = new Database();
