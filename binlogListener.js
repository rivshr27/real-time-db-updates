const MySQLEvents = require('mysql-binlog-events');
require('dotenv').config();

class BinlogListener {
    constructor(database, webSocketServer) {
        this.database = database;
        this.wsServer = webSocketServer;
        this.mysqlEvents = null;
        this.isListening = false;
    }

    async start() {
        if (this.isListening) return;

        try {
            // Get database connection for binlog
            const connection = await this.database.getConnection();
            
            this.mysqlEvents = new MySQLEvents({
                host: process.env.DB_HOST,
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
                port: process.env.DB_PORT,
                database: process.env.DB_NAME,
                startAtEnd: true, // Start listening from current position
                serverId: Math.floor(Math.random() * 1000000), // Random server ID
            });

            // Listen for database changes
            this.mysqlEvents.on('binlog', (binlogEvent) => {
                this.handleBinlogEvent(binlogEvent);
            });

            this.mysqlEvents.on('error', (error) => {
                console.error('Binlog error:', error);
                this.restart();
            });

            this.mysqlEvents.on('connect', () => {
                console.log('Connected to MySQL binlog');
                this.isListening = true;
            });

            await this.mysqlEvents.start();
            connection.release();

        } catch (error) {
            console.error('Failed to start binlog listener:', error);
            // Fallback to polling if binlog fails
            this.startPollingFallback();
        }
    }

    handleBinlogEvent(binlogEvent) {
        // Filter for orders table events
        if (binlogEvent.getTableName() !== 'orders') return;

        const eventType = binlogEvent.getEventName();
        let changeData = {};

        switch (eventType) {
            case 'writerows': // INSERT
                changeData = {
                    type: 'INSERT',
                    table: 'orders',
                    data: this.formatBinlogData(binlogEvent.rows[0]),
                    timestamp: new Date().toISOString()
                };
                break;

            case 'updaterows': // UPDATE
                changeData = {
                    type: 'UPDATE',
                    table: 'orders',
                    oldData: this.formatBinlogData(binlogEvent.rows[0].before),
                    newData: this.formatBinlogData(binlogEvent.rows[0].after),
                    timestamp: new Date().toISOString()
                };
                break;

            case 'deleterows': // DELETE
                changeData = {
                    type: 'DELETE',
                    table: 'orders',
                    data: this.formatBinlogData(binlogEvent.rows[0]),
                    timestamp: new Date().toISOString()
                };
                break;

            default:
                return; // Ignore other event types
        }


        this.broadcastChange(changeData);
    }

    formatBinlogData(row) {
        if (!row) return null;
        
        return {
            id: row.id,
            customer_name: row.customer_name,
            product_name: row.product_name,
            status: row.status,
            updated_at: row.updated_at,
            created_at: row.created_at
        };
    }

    broadcastChange(changeData) {
        const message = JSON.stringify(changeData);
        
        this.wsServer.clients.forEach((client) => {
            if (client.readyState === 1) { // WebSocket.OPEN
                client.send(message);
            }
        });

        console.log('Broadcasting change:', changeData.type, 'on orders table');
    }

    async restart() {
        console.log('Restarting binlog listener...');
        await this.stop();
        setTimeout(() => this.start(), 5000);
    }

    async stop() {
        if (this.mysqlEvents) {
            await this.mysqlEvents.stop();
            this.mysqlEvents = null;
        }
        this.isListening = false;
    }


    startPollingFallback() {
        console.log('Starting polling fallback mechanism...');
        let lastUpdateTime = new Date();

        setInterval(async () => {
            try {
                const recentChanges = await this.database.query(
                    'SELECT * FROM orders WHERE updated_at > ?',
                    [lastUpdateTime]
                );

                if (recentChanges.length > 0) {
                    recentChanges.forEach(order => {
                        this.broadcastChange({
                            type: 'UPDATE',
                            table: 'orders',
                            data: order,
                            timestamp: new Date().toISOString()
                        });
                    });
                    lastUpdateTime = new Date();
                }
            } catch (error) {
                console.error('Polling fallback error:', error);
            }
        }, 2000); // Poll every 2 seconds
    }
}

module.exports = BinlogListener;
