-- Create database
CREATE DATABASE IF NOT EXISTS realtime_orders;
USE realtime_orders;

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    status ENUM('pending', 'shipped', 'delivered') DEFAULT 'pending',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create change log table to track all changes
CREATE TABLE IF NOT EXISTS order_changes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT,
    operation_type ENUM('INSERT', 'UPDATE', 'DELETE') NOT NULL,
    old_data JSON,
    new_data JSON,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed BOOLEAN DEFAULT FALSE,
    INDEX idx_processed_time (processed, changed_at)
);

-- Trigger for INSERT operations
DELIMITER $$
CREATE TRIGGER orders_after_insert 
AFTER INSERT ON orders 
FOR EACH ROW 
BEGIN
    INSERT INTO order_changes (order_id, operation_type, new_data) 
    VALUES (NEW.id, 'INSERT', JSON_OBJECT(
        'id', NEW.id,
        'customer_name', NEW.customer_name,
        'product_name', NEW.product_name,
        'status', NEW.status,
        'updated_at', NEW.updated_at,
        'created_at', NEW.created_at
    ));
END$$

-- Trigger for UPDATE operations
CREATE TRIGGER orders_after_update 
AFTER UPDATE ON orders 
FOR EACH ROW 
BEGIN
    INSERT INTO order_changes (order_id, operation_type, old_data, new_data) 
    VALUES (NEW.id, 'UPDATE', 
        JSON_OBJECT(
            'id', OLD.id,
            'customer_name', OLD.customer_name,
            'product_name', OLD.product_name,
            'status', OLD.status,
            'updated_at', OLD.updated_at,
            'created_at', OLD.created_at
        ),
        JSON_OBJECT(
            'id', NEW.id,
            'customer_name', NEW.customer_name,
            'product_name', NEW.product_name,
            'status', NEW.status,
            'updated_at', NEW.updated_at,
            'created_at', NEW.created_at
        )
    );
END$$

-- Trigger for DELETE operations
CREATE TRIGGER orders_after_delete 
AFTER DELETE ON orders 
FOR EACH ROW 
BEGIN
    INSERT INTO order_changes (order_id, operation_type, old_data) 
    VALUES (OLD.id, 'DELETE', JSON_OBJECT(
        'id', OLD.id,
        'customer_name', OLD.customer_name,
        'product_name', OLD.product_name,
        'status', OLD.status,
        'updated_at', OLD.updated_at,
        'created_at', OLD.created_at
    ));
END$$
DELIMITER ;

-- Insert sample data
INSERT INTO orders (customer_name, product_name, status) VALUES
('John Doe', 'Laptop', 'pending'),
('Jane Smith', 'Phone', 'pending'),
('Bob Johnson', 'Tablet', 'shipped');
