const database = require('./database');

class ChangeListener {
    constructor(webSocketServer) {
        this.wsServer = webSocketServer;
        this.isListening = false;
        this.pollInterval = null;
        this.lastProcessedId = 0;
    }

    async start() {
        if (this.isListening) return;

        try {
            await this.initializeLastProcessedId();
            this.startPolling();
            this.isListening = true;
            console.log('Change listener started successfully');
        } catch (error) {
            console.error('Failed to start change listener:', error);
            throw error;
        }
    }

    async initializeLastProcessedId() {
        try {
            const result = await database.query(
                'SELECT MAX(id) as max_id FROM order_changes WHERE processed = 1'
            );
            this.lastProcessedId = result[0]?.max_id || 0;
            console.log(`Starting from change ID: ${this.lastProcessedId}`);
        } catch (error) {
            console.error('Error initializing last processed ID:', error);
            this.lastProcessedId = 0;
        }
    }

    startPolling() {
        this.pollInterval = setInterval(async () => {
            try {
                await this.checkForChanges();
            } catch (error) {
                console.error('Error checking for changes:', error);
            }
        }, 200);
    }

    async checkForChanges() {
        try {
            const changes = await database.query(`
                SELECT * FROM order_changes 
                WHERE id > ? AND processed = 0 
                ORDER BY id ASC 
                LIMIT 50
            `, [this.lastProcessedId]);

            if (changes.length === 0) return;

            for (const change of changes) {
                await this.processChange(change);
                this.lastProcessedId = change.id;
                
                await database.query(
                    'UPDATE order_changes SET processed = 1 WHERE id = ?',
                    [change.id]
                );
            }

            if (Math.random() < 0.1) {
                await this.cleanupOldChanges();
            }
        } catch (error) {
            console.error('Error in checkForChanges:', error);
        }
    }

    async processChange(change) {
        const changeData = {
            type: change.operation_type,
            table: 'orders',
            timestamp: change.changed_at,
            changeId: change.id
        };


        try {
            switch (change.operation_type) {
                case 'INSERT':
                    changeData.data = this.safeJSONParse(change.new_data);
                    break;
                case 'UPDATE':
                    changeData.oldData = this.safeJSONParse(change.old_data);
                    changeData.newData = this.safeJSONParse(change.new_data);
                    changeData.data = changeData.newData; // For compatibility
                    break;
                case 'DELETE':
                    changeData.data = this.safeJSONParse(change.old_data);
                    break;
            }


            if (changeData.data) {
                this.broadcastChange(changeData);
            }
        } catch (error) {
            console.error('Error processing change:', error, 'Change data:', change);
        }
    }


    safeJSONParse(jsonString) {
        if (!jsonString) return null;
        

        if (typeof jsonString === 'object') {
            return jsonString;
        }
        

        if (jsonString === '[object Object]' || jsonString.toString() === '[object Object]') {
            console.warn('Detected invalid JSON string: [object Object]');
            return null;
        }
        
        try {
            return JSON.parse(jsonString);
        } catch (error) {
            console.error('JSON Parse Error:', error.message, 'Data:', jsonString);
            return null;
        }
    }

    broadcastChange(changeData) {
        const message = JSON.stringify(changeData);
        let clientCount = 0;
        
        this.wsServer.clients.forEach((client) => {
            if (client.readyState === 1) { // WebSocket.OPEN
                client.send(message);
                clientCount++;
            }
        });

        console.log(`📡 ${changeData.type} change → ${clientCount} clients: ${changeData.data?.customer_name}'s ${changeData.data?.product_name}`);
    }

    async cleanupOldChanges() {
        try {
            await database.query(`
                DELETE FROM order_changes 
                WHERE processed = 1 
                AND id < (
                    SELECT id FROM (
                        SELECT id FROM order_changes 
                        WHERE processed = 1 
                        ORDER BY id DESC 
                        LIMIT 1 OFFSET 1000
                    )
                )
            `);
        } catch (error) {
            // Ignore cleanup errors
        }
    }

    async stop() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.isListening = false;
        console.log('Change listener stopped');
    }

    async getStats() {
        try {
            const [totalChanges] = await database.query(
                'SELECT COUNT(*) as total FROM order_changes'
            );
            const [pendingChanges] = await database.query(
                'SELECT COUNT(*) as pending FROM order_changes WHERE processed = 0'
            );
            const [recentChanges] = await database.query(`
                SELECT COUNT(*) as recent FROM order_changes 
                WHERE datetime(changed_at) > datetime('now', '-1 hour')
            `);

            return {
                totalChanges: totalChanges.total,
                pendingChanges: pendingChanges.pending,
                recentChanges: recentChanges.recent,
                lastProcessedId: this.lastProcessedId,
                isListening: this.isListening
            };
        } catch (error) {
            console.error('Error getting stats:', error);
            return null;
        }
    }
}

module.exports = ChangeListener;
