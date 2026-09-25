import * as m from '../../shared/messages.model';
import * as w from '../../game/world.model';
import * as engine from '../../game/engine';
import { TicksPerSecond, Matchmaking } from '../../game/constants';

// ---------------------------------------------------------------------------
// Local game host (solo / vs bots).
//
// The original Acolyte Fight is deterministic lockstep: the client runs the
// whole simulation from a stream of TickMsgs, and the server merely relays
// player actions grouped into ticks. This module re-implements that minimal
// relay entirely in the browser, so the game is playable offline with no
// backend. It exposes a fake socket.io-like object that sockets.tsx uses in
// place of a real connection.
// ---------------------------------------------------------------------------

// Solo matchmaking defaults (the server used per-room values).
const SoloMatchmaking = {
    MaxPlayers: 7,
    MinBots: 1,
    MaxBots: 2,
};

type Handler = (...args: any[]) => void;

interface LocalGame {
    id: string;
    universe: number;
    mod: Object;
    tick: number;
    joinable: boolean;
    finished: boolean;
    closeTick: number;
    nextPlayerId: number;
    humanHeroId: number;
    humanControlKey: number;
    actions: Map<number, m.ActionMsg>; // heroId -> latest action this turn
    controlMessages: m.ControlMsg[];
    controlKeys: Map<number, number>; // controlKey -> heroId
    bots: Set<number>; // bot heroIds
    activeCount: number; // number of human players (1 in solo)
    history: m.TickMsg[];
}

let gameCounter = 0;
let universeCounter = 1;
let controlKeyCounter = 1;

export class LocalSocket {
    id = 'local-' + Math.random().toString(36).slice(2, 8);
    connected = false;

    private handlers = new Map<string, Handler[]>();
    private game: LocalGame | null = null;
    private tickHandle: ReturnType<typeof setInterval> | null = null;

    constructor() {
        // Fire the connect handshake once the caller has registered listeners.
        setTimeout(() => {
            this.connected = true;
            this.fire('connect');
        }, 0);
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

    disconnect() {
        this.stopLoop();
        this.connected = false;
        return this;
    }

    close() {
        return this.disconnect();
    }

    // Routes client -> "server" events.
    emit(event: string, data?: any, ack?: (response: any) => void) {
        switch (event) {
            case 'instance':
                ack?.({ success: true, instanceId: 'local', server: 'local', region: 'local' });
                break;
            case 'room':
                ack?.({ success: true, roomId: data?.roomId ?? m.DefaultRoomId, mod: {} });
                break;
            case 'room.create':
                ack?.({ success: true, roomId: m.DefaultRoomId, server: 'local' });
                break;
            case 'join':
                this.onJoin(data as m.JoinMsg, ack);
                break;
            case 'bot':
                this.onAddBot();
                break;
            case 'leave':
                this.onLeave();
                break;
            case 'action':
                this.onAction(data as m.ActionMsg);
                break;
            case 'sync':
                this.onSync(data as m.SyncMsg);
                break;
            // Networking features with no offline equivalent: acknowledge and ignore.
            case 'party':
            case 'party.create':
            case 'party.settings':
            case 'party.status':
                ack?.({ success: false, error: 'Parties are not available offline' });
                break;
            case 'score':
            case 'online':
            case 'text':
            case 'performance':
            default:
                ack?.({ success: true });
                break;
        }
        return this;
    }

    // ----- Game host logic --------------------------------------------------

    private onJoin(msg: m.JoinMsg, ack?: (response: m.JoinResponseMsg) => void) {
        // Solo: always start a fresh game.
        this.stopLoop();

        const game = this.initGame();
        this.game = game;

        // Join the human.
        const heroId = engine.formatHeroId(game.nextPlayerId++);
        const controlKey = controlKeyCounter++;
        game.humanHeroId = heroId;
        game.humanControlKey = controlKey;
        game.controlKeys.set(controlKey, heroId);
        game.activeCount = 1;

        const reconnectKey = 'k-' + Math.random().toString(36).slice(2, 10);

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
        } as m.JoinActionMsg);

        // Add bots so there is always an opponent.
        const numBots = Math.max(
            msg?.numBots || 0,
            SoloMatchmaking.MinBots + Math.round(Math.random() * (SoloMatchmaking.MaxBots - SoloMatchmaking.MinBots)),
        );
        for (let i = 0; i < numBots; ++i) {
            this.addBot(game);
        }

        // Tell the client about the game (sets up its world).
        const heroMsg: m.HeroMsg = {
            gameId: game.id,
            universeId: game.universe,
            heroId,
            controlKey,
            reconnectKey,
            userHash: null,
            partyId: null,
            room: msg?.room ?? m.DefaultRoomId,
            locked: null,
            autoJoin: msg?.autoJoin,
            mod: game.mod,
            live: true,
            history: game.history,
            splits: [],
        };
        this.fire('hero', heroMsg);
        ack?.({ success: true });

        this.startLoop();
    }

    private initGame(): LocalGame {
        const index = gameCounter++;
        return {
            id: 'g' + index + '-' + Math.random().toString(36).slice(2, 8),
            universe: universeCounter++,
            mod: {},
            tick: 0,
            joinable: true,
            finished: false,
            closeTick: Matchmaking.MaxHistoryLength,
            nextPlayerId: 0,
            humanHeroId: null,
            humanControlKey: null,
            actions: new Map(),
            controlMessages: [{ type: 'environment', seed: index } as m.EnvironmentMsg],
            controlKeys: new Map(),
            bots: new Set(),
            activeCount: 0,
            history: [],
        };
    }

    private onAddBot() {
        if (this.game) {
            this.addBot(this.game);
        }
    }

    private addBot(game: LocalGame) {
        const numPlayers = game.activeCount + game.bots.size;
        if (numPlayers >= SoloMatchmaking.MaxPlayers || !game.joinable) {
            return;
        }
        const heroId = engine.formatHeroId(game.nextPlayerId++);
        const controlKey = controlKeyCounter++;
        game.bots.add(heroId);
        game.controlKeys.set(controlKey, heroId);
        game.controlMessages.push({
            type: 'bot',
            heroId,
            controlKey,
            difficulty: 1,
        } as m.BotActionMsg);
    }

    private onAction(data: m.ActionMsg) {
        const game = this.game;
        if (!game || !data) {
            return;
        }
        const heroId = game.controlKeys.get(data.c);
        if (!heroId) {
            return;
        }
        const currentPrecedence = actionPrecedence(game.actions.get(heroId));
        const newPrecedence = actionPrecedence(data);
        if (newPrecedence >= currentPrecedence) {
            game.actions.set(heroId, data);
        }
    }

    private onSync(_data: m.SyncMsg) {
        // Sync is used to reconcile divergence between peers. With a single
        // authoritative local simulation there is nothing to reconcile.
    }

    private onLeave() {
        this.stopLoop();
        this.game = null;
    }

    // ----- Tick loop --------------------------------------------------------

    private startLoop() {
        if (this.tickHandle) {
            return;
        }
        const intervalMs = 1000 / TicksPerSecond;
        this.tickHandle = setInterval(() => this.gameTick(), intervalMs);
    }

    private stopLoop() {
        if (this.tickHandle) {
            clearInterval(this.tickHandle);
            this.tickHandle = null;
        }
    }

    private gameTick() {
        const game = this.game;
        if (!game || game.finished) {
            return;
        }

        this.closeGameIfNecessary(game);

        const data: m.TickMsg = {
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
        }

        if (game.history.length < Matchmaking.MaxHistoryLength) {
            game.history.push(data);
        }

        this.fire('tick', data);
    }

    private closeGameIfNecessary(game: LocalGame) {
        if (!game.joinable) {
            return;
        }

        let waitPeriod: number = null;

        const numPlayers = game.activeCount + game.bots.size;
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
        }

        if (waitPeriod !== null) {
            game.controlMessages.push({
                type: m.ActionType.CloseGame,
                closeTick: game.closeTick,
                waitPeriod,
            } as m.CloseGameMsg);
        }
    }
}

function actionPrecedence(actionData: m.ActionMsg): number {
    if (!actionData) {
        return 0;
    } else if (actionData.type === 'spells') {
        return 101;
    } else if (actionData.type === 'game' && actionData.s === w.Actions.Stop) {
        return 12;
    } else if (actionData.type === 'game' && actionData.s === w.Actions.MoveAndCancel) {
        return 11;
    } else if (actionData.type === 'game' && actionData.s === w.Actions.Move) {
        return 10;
    } else if (actionData.type === 'game' && actionData.s === w.Actions.Retarget) {
        return 1;
    } else if (actionData.type === 'game' && (actionData as m.GameActionMsg).r) {
        return 99;
    } else {
        return 100;
    }
}

function isSpell(actionData: m.ActionMsg): boolean {
    return actionData.type === 'game' && !w.Actions.NonGameStarters.some(x => x === (actionData as m.GameActionMsg).s);
}

export function createLocalSocket(): LocalSocket {
    return new LocalSocket();
}
