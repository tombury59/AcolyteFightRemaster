// ---------------------------------------------------------------------------
// Minimal multiplayer relay server for AcolyteFightRemaster (play with friends).
//
// Transports the client's socket.io-like protocol over a raw WebSocket and
// relays deterministic-lockstep ticks (see relay.ts). No database, no accounts,
// no regions — friends connect, optionally via a room code, and play.
//
// D'apres Acolyte Fight de Ray Hidayat. Non-commercial use only.
// ---------------------------------------------------------------------------

import http from 'http';
import { randomUUID } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Relay, Conn } from './relay.js';
import { ClientFrame, DefaultRoomId } from './protocol.js';

const PORT = Number(process.env.PORT || 7770);
const INSTANCE_ID = process.env.INSTANCE_ID || randomUUID();
const SERVER_NAME = process.env.SERVER_NAME || 'friends';

const relay = new Relay({
    maxPlayers: Number(process.env.MAX_PLAYERS || 7),
    minBots: Number(process.env.MIN_BOTS || 0),
    maxBots: Number(process.env.MAX_BOTS || 0),
});

// ----- HTTP: health check (used by hosting platforms) ----------------------

const httpServer = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, instance: INSTANCE_ID, ...relay.stats() }));
    } else {
        res.writeHead(404);
        res.end();
    }
});

// ----- WebSocket: game relay ----------------------------------------------

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws: WebSocket) => {
    const connId = 's-' + randomUUID().slice(0, 8);

    const conn: Conn = {
        id: connId,
        send(event: string, ...args: any[]) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ t: 'fire', event, args }));
            }
        },
    };
    relay.addConn(conn);

    const ack = (id: number | undefined, response: any) => {
        if (id !== undefined && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ t: 'ack', ack: id, response }));
        }
    };

    // Let the client run its connect handshake.
    conn.send('connect');

    ws.on('message', (raw: Buffer) => {
        let frame: ClientFrame;
        try {
            frame = JSON.parse(raw.toString());
        } catch {
            return;
        }
        if (!frame || frame.t !== 'emit') {
            return;
        }
        route(frame.event, frame.data, frame.ack);
    });

    ws.on('close', () => {
        relay.removeConn(connId);
    });

    ws.on('error', () => {
        relay.removeConn(connId);
    });

    function route(event: string, data: any, ackId: number | undefined) {
        switch (event) {
            case 'instance':
                ack(ackId, { success: true, instanceId: INSTANCE_ID, server: SERVER_NAME, region: SERVER_NAME });
                break;
            case 'room':
                ack(ackId, { success: true, roomId: data?.roomId ?? DefaultRoomId, mod: {} });
                break;
            case 'room.create':
                ack(ackId, { success: true, roomId: data?.roomId ?? DefaultRoomId, server: SERVER_NAME });
                break;
            case 'join':
                relay.join(conn, data);
                ack(ackId, { success: true });
                break;
            case 'bot':
                relay.addBotToConnGame(connId);
                ack(ackId, { success: true });
                break;
            case 'leave':
                relay.leave(connId);
                ack(ackId, { success: true });
                break;
            case 'action':
                relay.action(connId, data);
                break;
            case 'sync':
                relay.sync(connId, data);
                break;
            // Not available in this friends-only relay: acknowledge and ignore.
            case 'party':
            case 'party.create':
            case 'party.settings':
            case 'party.status':
                ack(ackId, { success: false, error: 'Parties are not available' });
                break;
            default:
                ack(ackId, { success: true });
                break;
        }
    }
});

httpServer.listen(PORT, () => {
    console.log(`AcolyteFightRemaster relay listening on :${PORT} (instance ${INSTANCE_ID})`);
});
