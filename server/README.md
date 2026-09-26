# Serveur relais multijoueur — AcolyteFightRemaster

Relais WebSocket minimal pour jouer entre amis. Le jeu est en **lockstep
déterministe** : chaque client simule le monde entier à partir d'un flux de
`TickMsg` ; le serveur ne simule jamais, il **relaie** seulement les actions des
joueurs regroupées en ticks. C'est la promotion réseau de la boucle locale solo
(`src/client/core/localServer.tsx`).

_D'après Acolyte Fight de Ray Hidayat. Usage non commercial uniquement._

## Lancer en local

```bash
cd server
npm install
npm run dev        # tsx watch, écoute sur :7770
```

Puis, côté client (à la racine du projet), lance le front en mode en ligne :

```bash
npm run dev:online   # = VITE_SERVER_URL=ws://localhost:7770 vite
```

Ouvre deux onglets/navigateurs, clique **Play** dans chacun : les joueurs de la
même *room* atterrissent dans la même partie.

Vérifier l'état du serveur : `curl http://localhost:7770/health`.

## Variables d'environnement

| Variable      | Défaut     | Rôle                                                        |
|---------------|------------|-------------------------------------------------------------|
| `PORT`        | `7770`     | Port HTTP/WebSocket.                                        |
| `MAX_PLAYERS` | `7`        | Joueurs max par partie.                                     |
| `MIN_BOTS`    | `0`        | Bots ajoutés d'office (0 = partie 100 % amis).             |
| `MAX_BOTS`    | `0`        | Borne haute du remplissage aléatoire de bots.             |
| `SERVER_NAME` | `friends`  | Nom renvoyé au client (affichage).                         |
| `INSTANCE_ID` | aléatoire  | Identifiant d'instance (le client force un reload s'il change). |

> Les bots tournent côté client (IA en web worker). Le serveur diffuse le bot à
> tout le monde ; le **premier** client qui envoie une action pour ce bot en
> prend le contrôle (`takeBotControl`), les autres sont ignorés — la simulation
> reste déterministe.

## Déploiement (Lot D)

- Node ≥ 20. Démarrage : `npm start` (via `tsx`).
- Exposer le port `PORT` en **WSS** derrière HTTPS (Fly.io, Render, Railway…).
- Health check : `GET /health` (renvoie `{ ok: true, ... }`).
- Côté front, builder avec `VITE_SERVER_URL=wss://<hôte-du-relais>`.

## Protocole (résumé)

JSON sur WebSocket, API façon socket.io :

- client → serveur : `{"t":"emit","event","data?","ack?"}`
- serveur → client : `{"t":"ack","ack","response"}` ou `{"t":"fire","event","args"}`

Événements gérés : `instance`, `room`, `join`, `bot`, `leave`, `action`, `sync`.
Voir `src/protocol.ts` (format wire) et `src/relay.ts` (logique de relais). Le
pendant client vit dans `src/client/core/remoteServer.tsx`.
