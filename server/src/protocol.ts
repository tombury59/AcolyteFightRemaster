// ---------------------------------------------------------------------------
// Wire protocol + game constants for the relay server.
//
// The client speaks a tiny socket.io-like API (emit/on with optional acks).
// We carry it over a raw WebSocket as JSON frames. The client side of this
// protocol lives in src/client/core/remoteServer.tsx; keep the two in sync.
//
// The message shapes (TickMsg, control messages, actions) mirror the client
// models in src/game/networking.model.tsx and src/shared/messages.model.tsx —
// those files are the source of truth. We redeclare the minimal subset here so
// the server stays decoupled from the (browser-oriented) game engine.
// ---------------------------------------------------------------------------

// ----- Wire frames ---------------------------------------------------------

// Client -> server. `ack` (when present) asks for a correlated response.
export interface EmitFrame {
    t: 'emit';
    event: string;
    data?: any;
    ack?: number;
}

// Server -> client: response to an emit that requested an ack.
export interface AckFrame {
    t: 'ack';
    ack: number;
    response: any;
}

// Server -> client: a pushed event ('connect', 'hero', 'tick', ...).
export interface FireFrame {
    t: 'fire';
    event: string;
    args: any[];
}

export type ClientFrame = EmitFrame;
export type ServerFrame = AckFrame | FireFrame;

// ----- Game constants (mirror src/game/constants.tsx) ----------------------

export const TicksPerSecond = 60;
export const TicksPerTurn = 1;
export const MaxIdleTicks = 30 * TicksPerSecond;

export const Matchmaking = {
    MaxHistoryLength: 15 * 60 * TicksPerSecond,
    WaitForMorePeriod: 10 * TicksPerSecond,
    JoinPeriod: 3 * TicksPerSecond,
};

// formatHeroId(index) = Ids.HeroShard | index  (src/game/engine.tsx)
export const HeroShard = 1 << 24;
export function formatHeroId(index: number): number {
    return HeroShard | index;
}

// world.model Actions.NonGameStarters — actions that do NOT start a game.
export const NonGameStarters = ['move', 'go', 'retarget', 'stop'];
export const StopAction = 'stop';
export const MoveAndCancelAction = 'go';
export const MoveAction = 'move';
export const RetargetAction = 'retarget';

export const DefaultRoomId = 'r-default';

// ----- Minimal message shapes ----------------------------------------------

export interface ControlMsg {
    type: string;
    [key: string]: any;
}

export interface ActionMsg {
    type: string;
    c: number; // controlKey
    s?: string; // spell id (game actions)
    r?: boolean; // release
    [key: string]: any;
}

export interface TickMsg {
    u: number; // universe
    t: number; // tick
    a?: ActionMsg[];
    c?: ControlMsg[];
    s?: any; // sync
}

export interface JoinMsg {
    server?: string;
    gameId?: string | null;
    room?: string | null;
    partyId?: string | null;
    name?: string;
    keyBindings?: any;
    isMobile?: boolean;
    observe?: boolean;
    live?: boolean;
    autoJoin?: boolean;
    locked?: string | null;
    version?: string;
    unranked?: boolean;
    reconnectKey?: string;
    numBots?: number;
    numGames?: number;
}

export interface HeroMsg {
    gameId: string;
    universeId: number;
    heroId: number | null;
    controlKey: number | null;
    reconnectKey: string | null;
    userHash: string | null;
    partyId: string | null;
    room: string | null;
    locked: string | null;
    autoJoin?: boolean;
    mod: object;
    live: boolean;
    history: TickMsg[];
    splits?: any[];
}
