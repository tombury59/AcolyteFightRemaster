import * as m from '../../shared/messages.model';
import * as w from '../../game/world.model';
import * as messages from './messages';
import * as StoreProvider from '../storeProvider';
import * as url from '../url';
import { createLocalSocket } from './localServer';
import { createRemoteSocket } from './remoteServer';

let currentSocket: any = null;

export let listeners: Listeners = {
	onTickMsg: () => { },
	onPartyMsg: () => { },
	onGameMsg: () => { },
	onHeroMsg: () => { },
	onOnlineMsg: () => { },
	onPerformanceMsg: () => { },
	onReconnect: (socket) => { },
	onDisconnect: () => { },
};

export interface Listeners {
	onTickMsg: (msg: m.TickMsg) => void;
	onPartyMsg: (msg: m.PartyMsg) => void;
	onGameMsg: (msg: m.GameStatsMsg) => void;
	onHeroMsg: (msg: m.HeroMsg) => void;
	onOnlineMsg: (msg: m.OnlineMsg) => void;
	onPerformanceMsg: (msg: m.PerformanceStatsMsg) => void;
	onReconnect: (socket: any) => void;
	onDisconnect: () => void;
}

export function getSocket() {
	return currentSocket;
}

export function connect(
	socketUrl: string,
	authToken: string): Promise<any> {

	return new Promise<any>((resolve, reject) => {
		// Pick the transport: online multiplayer via the relay server when a
		// server URL is configured, otherwise the solo in-browser loopback.
		// Both expose the same socket.io-like API, so the code below is shared.
		const socket: any = url.online
			? createRemoteSocket(url.serverUrl)
			: createLocalSocket();

		let alreadyConnected = false;
		let serverInstanceId: string = null;

		socket.on('connect', () => {
			console.log("Connected as socket " + socket.id);
			socket.emit('instance', {} as m.ServerInstanceRequest, (response: m.ServerInstanceResponse) => {
				const newInstanceId = response.instanceId;
				if (serverInstanceId && serverInstanceId !== newInstanceId) {
					// The server has restarted, we need to reload because there might be a new release
					console.log("Server instance changed, forcing disconnect", serverInstanceId, newInstanceId);
					onServerRestarted();
					reject();
				} else {
					serverInstanceId = newInstanceId;
					StoreProvider.dispatch({ type: "updateServer", server: response.server, region: response.region, socketId: socket.id });
					console.log("Connected to server", response.server, response.region);

					if (alreadyConnected) {
						listeners.onReconnect(socket);
					} else {
						alreadyConnected = true;

						const previousSocket = currentSocket;
						currentSocket = socket; // The socket is ready, make it used globally

						if (previousSocket && previousSocket !== currentSocket) {
							previousSocket.disconnect(); // Disconnect from previous socket
							listeners.onReconnect(currentSocket); // Reconnect to new socket
						}

						resolve(socket);
					}
				}
			});
		});
		socket.on('connect_error', (error: any) => {
			if (!alreadyConnected) {
				console.log("Socket connect error", error);
				reject(error);
			}
		});
		socket.on('connect_timeout', (timeout: any) => {
			if (!alreadyConnected) {
				console.log("Socket connect timeout", timeout);
				reject(timeout);
			}
		});
		socket.on('disconnect', (reason: string) => {
			console.log("Disconnected", reason);

			if (reason === 'io server disconnect') {
				onServerRestarted(); // no reconnect when the server itself has restarted
			}

			if (!alreadyConnected) {
				socket.close();
				reject("Failed to establish initial connection with server");
			}

			listeners.onDisconnect();
		});
		socket.on('tick', (msg: m.TickMsg) => listeners.onTickMsg(msg));
		socket.on('party', (msg: m.PartyMsg) => listeners.onPartyMsg(msg));
		socket.on('game', (msg: m.GameStatsMsg) => listeners.onGameMsg(msg));
		socket.on('hero', (msg: m.HeroMsg) => listeners.onHeroMsg(msg));
		socket.on('online', (msg: m.OnlineMsg) => listeners.onOnlineMsg(msg));
		socket.on('performance', (msg: m.PerformanceStatsMsg) => listeners.onPerformanceMsg(msg));
		socket.on('shutdown', (msg: any) => onServerPreparingToShutdown());
	});
}


function onServerPreparingToShutdown() {
	console.log("Server preparing to shutdown");
	StoreProvider.dispatch({ type: "serverPreparingToShutdown" });
}

function onServerRestarted() {
	console.log("Server restarted");
	StoreProvider.dispatch({ type: "disconnected" });
	messages.push({ type: "disconnected" });
}