// ---------------------------------------------------------------------------
// Online multiplayer transport (play with friends).
//
// Speaks the same socket.io-like API as the solo loopback (localServer.tsx),
// but over a real WebSocket to the relay server (see server/). sockets.tsx
// picks this transport when a server URL is configured (url.online); otherwise
// it uses the local loopback for solo play. Both feed the exact same client
// code path, so nothing downstream changes.
//
// Wire protocol mirrors server/src/protocol.ts:
//   client -> server: {"t":"emit","event","data?","ack?"}
//   server -> client: {"t":"ack","ack","response"} | {"t":"fire","event","args"}
// ---------------------------------------------------------------------------

type Handler = (...args: any[]) => void;

interface PendingEmit {
    event: string;
    data?: any;
    ackId?: number;
}

export class RemoteSocket {
    id = 'remote-' + Math.random().toString(36).slice(2, 8);
    connected = false;

    private ws: WebSocket;
    private handlers = new Map<string, Handler[]>();
    private acks = new Map<number, (response: any) => void>();
    private ackCounter = 1;
    private queue: PendingEmit[] = [];
    private closed = false;

    constructor(private url: string) {
        this.ws = new WebSocket(url);
        this.ws.onopen = () => {
            this.connected = true;
            this.flushQueue();
            this.fire('connect');
        };
        this.ws.onmessage = (ev: MessageEvent) => this.onMessage(ev);
        this.ws.onclose = () => {
            this.connected = false;
            if (!this.closed) {
                this.fire('disconnect', 'transport close');
            }
        };
        this.ws.onerror = () => {
            if (!this.connected) {
                this.fire('connect_error', new Error('WebSocket error'));
            }
        };
    }

    on(event: string, cb: Handler) {
        const list = this.handlers.get(event) || [];
        list.push(cb);
        this.handlers.set(event, list);
        return this;
    }

    off(event: string) {
        this.handlers.delete(event);
        return this;
    }

    private fire(event: string, ...args: any[]) {
        const list = this.handlers.get(event);
        if (list) {
            for (const cb of list) {
                cb(...args);
            }
        }
    }

    emit(event: string, data?: any, ack?: (response: any) => void) {
        let ackId: number | undefined;
        if (ack) {
            ackId = this.ackCounter++;
            this.acks.set(ackId, ack);
        }
        const pending: PendingEmit = { event, data, ackId };
        if (this.ws.readyState === WebSocket.OPEN) {
            this.sendFrame(pending);
        } else {
            this.queue.push(pending);
        }
        return this;
    }

    disconnect() {
        this.closed = true;
        this.connected = false;
        try {
            this.ws.close();
        } catch {
            // ignore
        }
        return this;
    }

    close() {
        return this.disconnect();
    }

    // ----- Internals -------------------------------------------------------

    private sendFrame(pending: PendingEmit) {
        this.ws.send(JSON.stringify({
            t: 'emit',
            event: pending.event,
            data: pending.data,
            ack: pending.ackId,
        }));
    }

    private flushQueue() {
        const pending = this.queue;
        this.queue = [];
        for (const p of pending) {
            this.sendFrame(p);
        }
    }

    private onMessage(ev: MessageEvent) {
        let frame: any;
        try {
            frame = JSON.parse(ev.data as string);
        } catch {
            return;
        }
        if (!frame) {
            return;
        }
        if (frame.t === 'ack') {
            const cb = this.acks.get(frame.ack);
            if (cb) {
                this.acks.delete(frame.ack);
                cb(frame.response);
            }
        } else if (frame.t === 'fire') {
            // The server also emits a 'connect' event; we already fire our own
            // on ws open, so ignore the duplicate.
            if (frame.event === 'connect') {
                return;
            }
            this.fire(frame.event, ...(frame.args || []));
        }
    }
}

export function createRemoteSocket(url: string): RemoteSocket {
    return new RemoteSocket(url);
}
