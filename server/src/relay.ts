// ---------------------------------------------------------------------------
// Deterministic-lockstep relay (multi-client, multi-room).
//
// Acolyte Fight is deterministic lockstep: every client runs the full
// simulation from a stream of TickMsgs; the server only relays player actions
// grouped into ticks. It never simulates. This module is the network promotion
// of src/client/core/localServer.tsx (the solo loopback), reusing the exact
// relay rules of the original server (src/server/core/{games,ticker}.tsx from
// git history ba300ec) while dropping regions, parties, ranking and storage.
//
// Bots: a bot hero is broadcast to everyone (isSharedBot => every client
// simulates it and runs its AI). Duplicate bot actions are gated here: the
// FIRST connection to send an action for a given bot claims it
// (takeBotControl); other connections' actions for that bot are dropped, so the
// simulation stays deterministic.
// ---------------------------------------------------------------------------

import {
    ActionMsg,
    ControlMsg,
    HeroMsg,
    JoinMsg,
    Matchmaking,
    MaxIdleTicks,
    NonGameStarters,
    StopAction,
    MoveAndCancelAction,
    MoveAction,
    RetargetAction,
    TickMsg,
    TicksPerSecond,
    TicksPerTurn,
    formatHeroId,
} from './protocol.js';

// A live client connection, as seen by the relay (transport-agnostic).
export interface Conn {
    id: string;
    send(event: string, ...args: any[]): void;
}

interface Player {
    connId: string;
    heroId: number;
    controlKey: number;
    name: string;
    numGames: number;
}

interface Game {
    id: string;
    roomId: string;
    universe: number;
    mod: object;
    tick: number;
    activeTick: number;
    joinable: boolean;
    finished: boolean;
    closeTick: number;
    nextPlayerId: number;
    active: Map<string, Player>;         // connId -> player (humans)
    observers: Set<string>;              // connId of observers (no hero)
    bots: Map<number, string | null>;    // botHeroId -> owning connId (or null)
    controlKeys: Map<number, number>;    // controlKey -> heroId
    reconnectKeys: Map<string, number>;  // reconnectKey -> heroId
    controlKeyByHero: Map<number, number>;
    actions: Map<number, ActionMsg>;     // heroId -> latest action this turn
    controlMessages: ControlMsg[];
    history: TickMsg[];
}

interface Room {
    id: string;
    mod: object;
}

export interface RelayConfig {
    maxPlayers: number;
    minBots: number;
    maxBots: number;
}

export class Relay {
    private rooms = new Map<string, Room>();
    private games = new Map<string, Game>();
    private joinableByRoom = new Map<string, string>(); // roomId -> gameId
    private connGame = new Map<string, string>();        // connId -> gameId

    private gameCounter = 0;
    private universeCounter = 1;
    private controlKeyCounter = 1;

    private tickHandle: ReturnType<typeof setInterval> | null = null;
    private conns = new Map<string, Conn>();

    // lightweight metrics (exposed on /health)
    private metricActionsReceived = 0;
    private metricActionsAccepted = 0;
    private metricTicksEmitted = 0;

    constructor(private config: RelayConfig) {}

    // ----- Connection lifecycle --------------------------------------------

    addConn(conn: Conn) {
        this.conns.set(conn.id, conn);
    }

    removeConn(connId: string) {
        this.leave(connId);
        this.conns.delete(connId);
    }

    // ----- Room control ----------------------------------------------------

    getOrCreateRoom(roomId: string | null | undefined): Room {
        const id = roomId || 'r-default';
        let room = this.rooms.get(id);
        if (!room) {
            room = { id, mod: {} };
            this.rooms.set(id, room);
        }
        return room;
    }

    // ----- Join ------------------------------------------------------------

    join(conn: Conn, msg: JoinMsg): void {
        // Leave any previous game first (Play again, re-join).
        this.leave(conn.id);

        const room = this.getOrCreateRoom(msg?.room);
        const observe = !!msg?.observe;
        const locked = msg?.locked || null;

        // Locked games (tutorial, mod preview) are private: never shared with
        // other players, so each such join gets its own isolated game.
        let game = locked ? null : this.findJoinableGame(room.id, msg);
        if (!game) {
            game = this.createGame(room, locked);
        }

        this.connGame.set(conn.id, game.id);

        if (observe) {
            game.observers.add(conn.id);
            this.sendHero(conn, game, null, null, null, msg, true);
            return;
        }

        // Reconnect to an existing hero if the key matches.
        let heroId: number | null = null;
        let controlKey: number | null = null;
        const reconnectKey = msg?.reconnectKey;
        if (reconnectKey && game.reconnectKeys.has(reconnectKey)) {
            heroId = game.reconnectKeys.get(reconnectKey)!;
            controlKey = game.controlKeyByHero.get(heroId) ?? this.newControlKey(game, heroId);
        } else {
            heroId = formatHeroId(game.nextPlayerId++);
            controlKey = this.newControlKey(game, heroId);
            game.controlMessages.push({
                type: 'join',
                heroId,
                controlKey,
                userId: null,
                userHash: null,
                playerName: msg?.name || 'Acolyte',
                keyBindings: msg?.keyBindings || {},
                isMobile: msg?.isMobile || false,
                numGames: msg?.numGames || 0,
            });
        }

        const newReconnectKey = 'k-' + Math.random().toString(36).slice(2, 10);
        game.reconnectKeys.set(newReconnectKey, heroId);
        game.active.set(conn.id, {
            connId: conn.id,
            heroId,
            controlKey,
            name: msg?.name || 'Acolyte',
            numGames: msg?.numGames || 0,
        });

        // Fill bots: honour an explicit request, and optionally a configured
        // minimum so a lone player still has an opponent.
        this.fillBots(game, msg?.numBots || 0);

        this.sendHero(conn, game, heroId, controlKey, newReconnectKey, msg, true);

        this.ensureTickLoop();
    }

    private findJoinableGame(roomId: string, msg: JoinMsg): Game | null {
        // Explicit game id (spectate / rejoin a specific game).
        if (msg?.gameId) {
            const g = this.games.get(msg.gameId);
            if (g && !g.finished) {
                return g;
            }
        }
        const gameId = this.joinableByRoom.get(roomId);
        if (gameId) {
            const g = this.games.get(gameId);
            if (g && g.joinable && !g.finished && this.numPlayers(g) < this.config.maxPlayers) {
                return g;
            }
            this.joinableByRoom.delete(roomId);
        }
        return null;
    }

    private createGame(room: Room, locked: string | null = null): Game {
        const index = this.gameCounter++;
        const game: Game = {
            id: 'g' + index + '-' + Math.random().toString(36).slice(2, 8),
            roomId: room.id,
            universe: this.universeCounter++,
            mod: room.mod || {},
            tick: 0,
            activeTick: 0,
            joinable: true,
            finished: false,
            closeTick: Matchmaking.MaxHistoryLength,
            nextPlayerId: 0,
            active: new Map(),
            observers: new Set(),
            bots: new Map(),
            controlKeys: new Map(),
            reconnectKeys: new Map(),
            controlKeyByHero: new Map(),
            actions: new Map(),
            controlMessages: [{ type: 'environment', seed: index }],
            history: [],
        };
        this.games.set(game.id, game);
        // Only advertise public games for matchmaking; locked games stay private.
        if (!locked) {
            this.joinableByRoom.set(room.id, game.id);
        }
        return game;
    }

    private newControlKey(game: Game, heroId: number): number {
        const controlKey = this.controlKeyCounter++;
        game.controlKeys.set(controlKey, heroId);
        game.controlKeyByHero.set(heroId, controlKey);
        return controlKey;
    }

    private sendHero(
        conn: Conn,
        game: Game,
        heroId: number | null,
        controlKey: number | null,
        reconnectKey: string | null,
        msg: JoinMsg,
        live: boolean,
    ) {
        const hero: HeroMsg = {
            gameId: game.id,
            universeId: game.universe,
            heroId,
            controlKey,
            reconnectKey,
            userHash: null,
            partyId: null,
            room: game.roomId,
            locked: null,
            autoJoin: msg?.autoJoin,
            mod: game.mod,
            live,
            history: game.history,
            splits: [],
        };
        conn.send('hero', hero);
    }

    // ----- Bots ------------------------------------------------------------

    addBotToConnGame(connId: string): void {
        const game = this.getConnGame(connId);
        if (game) {
            this.addBot(game);
            this.ensureTickLoop();
        }
    }

    private fillBots(game: Game, requested: number) {
        const target = Math.max(
            requested,
            this.config.minBots
                ? this.config.minBots + Math.round(Math.random() * (this.config.maxBots - this.config.minBots))
                : 0,
        );
        const toAdd = target - game.bots.size;
        for (let i = 0; i < toAdd; ++i) {
            this.addBot(game);
        }
    }

    private addBot(game: Game): number | null {
        if (this.numPlayers(game) >= this.config.maxPlayers || game.active.size === 0 || !game.joinable) {
            return null;
        }
        const heroId = formatHeroId(game.nextPlayerId++);
        const controlKey = this.newControlKey(game, heroId);
        game.bots.set(heroId, null);
        game.controlMessages.push({
            type: 'bot',
            heroId,
            controlKey,
            difficulty: 1,
        });
        return heroId;
    }

    // First connection to send an action for a bot claims control of it.
    private takeBotControl(game: Game, heroId: number, connId: string): boolean {
        if (!game.bots.has(heroId)) {
            return false;
        }
        const owner = game.bots.get(heroId);
        if (owner) {
            return owner === connId;
        }
        if (game.active.has(connId)) {
            game.bots.set(heroId, connId);
            return true;
        }
        return false;
    }

    // ----- Actions ---------------------------------------------------------

    action(connId: string, data: ActionMsg): void {
        const game = this.getConnGame(connId);
        if (!game || !data) {
            return;
        }
        const player = game.active.get(connId);
        const heroId = game.controlKeys.get(data.c);
        if (heroId === undefined) {
            return;
        }
        this.metricActionsReceived++;
        const isOwnHero = !!player && heroId === player.heroId;
        if (isOwnHero || this.takeBotControl(game, heroId, connId)) {
            this.metricActionsAccepted++;
            this.queueAction(game, data);
            // A new message may need processing even if the game had gone idle;
            // restart the tick loop (the original server did this via
            // queuedMessageListener -> startTickProcessing).
            this.ensureTickLoop();
        }
    }

    private queueAction(game: Game, data: ActionMsg) {
        const heroId = game.controlKeys.get(data.c);
        if (heroId === undefined) {
            return;
        }
        const current = actionPrecedence(game.actions.get(heroId));
        const next = actionPrecedence(data);
        if (next >= current) {
            game.actions.set(heroId, data);
        }
    }

    sync(_connId: string, _data: any): void {
        // With a single authoritative history there is nothing to reconcile;
        // clients replay the same ticks. Sync is a no-op relay-side.
    }

    // ----- Leave -----------------------------------------------------------

    leave(connId: string): void {
        const game = this.getConnGame(connId);
        this.connGame.delete(connId);
        if (!game) {
            return;
        }

        game.observers.delete(connId);

        const player = game.active.get(connId);
        if (player) {
            game.active.delete(connId);
            // Leave a bot behind so the game keeps its shape mid-fight; if
            // unjoinable the hero is simply removed.
            game.controlMessages.push({
                type: 'leave',
                heroId: player.heroId,
                controlKey: game.joinable ? null : player.controlKey,
            });
        }

        // Release bots owned by the departed connection so someone else sims.
        game.bots.forEach((owner, heroId) => {
            if (owner === connId) {
                game.bots.set(heroId, null);
            }
        });

        if (game.active.size === 0) {
            // No humans left: no one to simulate. End the game.
            game.bots.clear();
            if (this.joinableByRoom.get(game.roomId) === game.id) {
                this.joinableByRoom.delete(game.roomId);
            }
        }

        // The leave queued a control message (and may need a finish tick);
        // make sure the loop runs to process it.
        this.ensureTickLoop();
    }

    // ----- Tick loop -------------------------------------------------------

    private ensureTickLoop() {
        if (this.tickHandle) {
            return;
        }
        const intervalMs = Math.floor(TicksPerTurn * (1000 / TicksPerSecond));
        this.tickHandle = setInterval(() => this.processAllGames(), intervalMs);
    }

    private processAllGames() {
        let anyRunning = false;
        for (const game of this.games.values()) {
            if (this.gameTurn(game)) {
                anyRunning = true;
            }
        }
        if (!anyRunning) {
            if (this.tickHandle) {
                clearInterval(this.tickHandle);
                this.tickHandle = null;
            }
        }
    }

    private gameTurn(game: Game): boolean {
        if (game.finished) {
            this.games.delete(game.id);
            return false;
        }
        const running =
            this.isGameRunning(game) || game.actions.size > 0 || game.controlMessages.length > 0;
        if (running) {
            for (let i = 0; i < TicksPerTurn; ++i) {
                this.gameTick(game);
            }
        }
        return running && !game.finished;
    }

    private isGameRunning(game: Game): boolean {
        return game.tick - game.activeTick < MaxIdleTicks;
    }

    private gameTick(game: Game) {
        if (game.finished) {
            return;
        }

        this.closeGameIfNecessary(game);
        this.finishGameIfNecessary(game);

        const data: TickMsg = {
            u: game.universe,
            t: game.tick++,
        };

        if (game.controlMessages.length > 0) {
            data.c = game.controlMessages;
            game.controlMessages = [];
        }

        if (game.actions.size > 0) {
            data.a = Array.from(game.actions.values());
            game.actions.clear();
            game.activeTick = game.tick;
        }

        if (game.history.length < Matchmaking.MaxHistoryLength) {
            game.history.push(data);
        } else {
            game.closeTick = Math.min(game.closeTick, game.tick);
        }

        this.emitTick(game, data);

        if (game.finished) {
            game.bots.clear();
            this.games.delete(game.id);
            if (this.joinableByRoom.get(game.roomId) === game.id) {
                this.joinableByRoom.delete(game.roomId);
            }
        }
    }

    private finishGameIfNecessary(game: Game) {
        if (game.finished) {
            return;
        }
        if (game.active.size > 0) {
            return;
        }
        game.finished = true;
        game.controlMessages.push({ type: 'finish' });
    }

    private closeGameIfNecessary(game: Game) {
        if (!game.joinable) {
            return;
        }

        let waitPeriod: number | null = null;

        const numPlayers = this.numPlayers(game);
        const someoneCastSpell = Array.from(game.actions.values()).some(isSpell);
        if (numPlayers > 1 && someoneCastSpell) {
            const newCloseTick = game.tick + Matchmaking.JoinPeriod;
            if (newCloseTick < game.closeTick) {
                game.closeTick = newCloseTick;
                waitPeriod = Matchmaking.JoinPeriod;
            }
        }

        if (game.tick >= game.closeTick) {
            game.joinable = false;
            waitPeriod = 0;
            if (this.joinableByRoom.get(game.roomId) === game.id) {
                this.joinableByRoom.delete(game.roomId);
            }
        }

        if (waitPeriod !== null) {
            game.controlMessages.push({
                type: 'close',
                closeTick: game.closeTick,
                waitPeriod,
            });
        }
    }

    private emitTick(game: Game, data: TickMsg) {
        this.metricTicksEmitted++;
        for (const connId of game.active.keys()) {
            this.conns.get(connId)?.send('tick', data);
        }
        for (const connId of game.observers) {
            this.conns.get(connId)?.send('tick', data);
        }
    }

    // ----- Helpers ---------------------------------------------------------

    private getConnGame(connId: string): Game | null {
        const gameId = this.connGame.get(connId);
        if (!gameId) {
            return null;
        }
        return this.games.get(gameId) || null;
    }

    private numPlayers(game: Game): number {
        return game.active.size + game.bots.size;
    }

    stats() {
        let activePlayers = 0;
        for (const game of this.games.values()) {
            activePlayers += game.active.size;
        }
        return {
            connections: this.conns.size,
            games: this.games.size,
            rooms: this.rooms.size,
            activePlayers,
            actionsReceived: this.metricActionsReceived,
            actionsAccepted: this.metricActionsAccepted,
            ticksEmitted: this.metricTicksEmitted,
        };
    }
}

function actionPrecedence(actionData: ActionMsg | undefined): number {
    if (!actionData) {
        return 0;
    } else if (actionData.type === 'spells') {
        return 101;
    } else if (actionData.type === 'game' && actionData.s === StopAction) {
        return 12;
    } else if (actionData.type === 'game' && actionData.s === MoveAndCancelAction) {
        return 11;
    } else if (actionData.type === 'game' && actionData.s === MoveAction) {
        return 10;
    } else if (actionData.type === 'game' && actionData.s === RetargetAction) {
        return 1;
    } else if (actionData.type === 'game' && actionData.r) {
        return 99;
    } else {
        return 100;
    }
}

function isSpell(actionData: ActionMsg): boolean {
    return actionData.type === 'game' && !NonGameStarters.some(x => x === actionData.s);
}
