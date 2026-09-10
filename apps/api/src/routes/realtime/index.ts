import { FastifyPluginAsync } from 'fastify';
import { registerClient } from '../../services/realtime.js';

/**
 * GET /ws — authenticated WebSocket for live updates. Native clients can't set
 * headers on the WS handshake, so the access token is passed as `?token=`.
 * The socket only ever receives server → client events (see services/realtime);
 * clients still send messages via the normal REST endpoints.
 */
const realtimeRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get('/ws', { websocket: true }, (connection, request) => {
        const socket = connection.socket;
        const token = (request.query as { token?: string })?.token;

        if (!token) {
            socket.close(1008, 'Missing token');
            return;
        }

        let payload: { tenantId?: string; type?: string };
        try {
            payload = fastify.jwt.verify(token);
        } catch {
            socket.close(1008, 'Invalid token');
            return;
        }

        if (!payload.tenantId || payload.type !== 'access') {
            socket.close(1008, 'Invalid token');
            return;
        }

        const unregister = registerClient(payload.tenantId, { send: (data) => socket.send(data) });
        socket.on('close', unregister);
        socket.on('error', unregister);

        socket.send(JSON.stringify({ type: 'connected' }));
    });
};

export default realtimeRoutes;
