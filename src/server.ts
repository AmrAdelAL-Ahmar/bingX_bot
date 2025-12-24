import http from 'http';
import logger from './utils/logger';

/**
 * Simple HTTP server for Render health checks
 * Render requires at least one open port to detect service is running
 */
export function startHealthServer(port: number = 3000) {
    const server = http.createServer((req, res) => {
        if (req.url === '/health' || req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                service: 'BingX Trading Bot',
                timestamp: new Date().toISOString()
            }));
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not Found' }));
        }
    });

    server.listen(port, '0.0.0.0', () => {
        logger.info(`Health check server listening on port ${port}`);
    });

    return server;
}
