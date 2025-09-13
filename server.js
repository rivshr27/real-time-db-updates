const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const database = require('./database');
const ChangeListener = require('./changeListener'); 
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// WebSocket Server
const wss = new WebSocket.Server({ 
    port: WS_PORT,
    clientTracking: true 
});

console.log(`WebSocket Server running on ws://localhost:${WS_PORT}`);

wss.on('connection', (ws, req) => {
    console.log(`Client connected`);
    
    // Send current orders to newly connected client
    database.getAllOrders()
        .then(orders => {
            ws.send(JSON.stringify({
                type: 'INITIAL_DATA',
                data: orders,
                timestamp: new Date().toISOString()
            }));
        })
        .catch(error => {
            console.error('Error sending initial data:', error);
        });

    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket client error:', error);
    });
});

// Initialize Change Listener
const changeListener = new ChangeListener(wss);

// REST API Routes
app.get('/api/orders', async (req, res) => {
    try {
        const orders = await database.getAllOrders();
        res.json({ success: true, data: orders });
    } catch (error) {
        console.error('Get orders error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/orders', async (req, res) => {
    try {
        const { customer_name, product_name, status } = req.body;
        
        if (!customer_name || !product_name) {
            return res.status(400).json({ 
                success: false, 
                error: 'customer_name and product_name are required' 
            });
        }

        const orderId = await database.createOrder(customer_name, product_name, status);
        const newOrder = await database.getOrderById(orderId);
        
        res.status(201).json({ success: true, data: newOrder });
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/orders/:id', async (req, res) => {
    try {
        const { customer_name, product_name, status } = req.body;
        const updateData = {};
        
        if (customer_name !== undefined) updateData.customer_name = customer_name;
        if (product_name !== undefined) updateData.product_name = product_name;
        if (status !== undefined) updateData.status = status;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ success: false, error: 'No valid fields to update' });
        }

        const updated = await database.updateOrder(req.params.id, updateData);
        
        if (!updated) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }

        const updatedOrder = await database.getOrderById(req.params.id);
        res.json({ success: true, data: updatedOrder });
    } catch (error) {
        console.error('Update order error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/orders/:id', async (req, res) => {
    try {
        const deleted = await database.deleteOrder(req.params.id);
        
        if (!deleted) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }

        res.json({ success: true, message: 'Order deleted successfully' });
    } catch (error) {
        console.error('Delete order error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Serve client page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        websocket_clients: wss.clients.size,
        change_listener_active: changeListener.isListening
    });
});

// Start HTTP server
app.listen(PORT, () => {
    console.log(`HTTP Server running on http://localhost:${PORT}`);
});

// Start change listener
changeListener.start().then(() => {
    console.log('Change listener started successfully');
}).catch(error => {
    console.error('Failed to start change listener:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('Shutting down gracefully...');
    await changeListener.stop();
    await database.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    await changeListener.stop();
    await database.close();
    process.exit(0);
});
