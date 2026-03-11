import WebSocket from 'ws';
import * as authService from './authService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'auth-failed';

export type StatusCallback = (status: WsStatus, peerId?: string) => void;
/** Called when the JWT is expired and a fresh token is needed. Must resolve on success, reject on failure. */
export type ReAuthCallback = () => Promise<void>;

// ─── Config ───────────────────────────────────────────────────────────────────

const MIN_DELAY = 2_000;   // 2 s
const MAX_DELAY = 60_000;  // 60 s

// Close codes defined by the server
const CODE_INVALID_JSON   = 4000;
const CODE_NO_AUTH_FIRST  = 4001;
const CODE_JWT_INVALID    = 4002;
const CODE_WRONG_ROLE     = 4003;
const CODE_REPLACED       = 4004;
const CODE_DB_ERROR       = 4005;

// ─── Module-level singleton state ────────────────────────────────────────────

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentDelay = MIN_DELAY;
let destroyed = false;

let onStatus: StatusCallback = () => {};
let onReAuth: ReAuthCallback = async () => {};
let onMessage: ((msg: Record<string, unknown>) => void) | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildWsUrl(apiBaseUrl: string): string {
    return apiBaseUrl
        .replace(/^https:\/\//, 'wss://')
        .replace(/^http:\/\//, 'ws://')
        .replace(/\/$/, '')
        + '/peer/ws';
}

function isJwtExpired(token: string): boolean {
    try {
        const parts = token.split('.');
        if (parts.length < 2 || !parts[1]) return true;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
        return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
    } catch {
        return true; // unparseable → treat as expired
    }
}

function clearReconnectTimer(): void {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Must be called once at app startup to register callbacks.
 * @param statusCb  Receives every status change. Called from main process.
 * @param reAuthCb  Called when the JWT is expired. Must refresh the token before resolving.
 */
export function init(statusCb: StatusCallback, reAuthCb: ReAuthCallback): void {
    onStatus = statusCb;
    onReAuth = reAuthCb;
}

/** Register a handler for all non-auth server messages (e.g. chunk_assignment). */
export function setMessageHandler(handler: (msg: Record<string, unknown>) => void): void {
    onMessage = handler;
}

/** Send a JSON string on the main WebSocket. Returns false if not connected. */
export function send(data: string): boolean {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(data);
    return true;
}

/** Open the WebSocket connection. Safe to call when already connected (no-op). */
export function start(): void {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    destroyed = false;
    currentDelay = MIN_DELAY;
    clearReconnectTimer();
    openConnection();
}

/** Gracefully close the connection (code 1000) and suppress all reconnect attempts. */
export function stop(): void {
    destroyed = true;
    clearReconnectTimer();
    if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'Client shutting down');
        } else {
            ws.terminate();
        }
        ws = null;
    }
    onStatus('disconnected');
}

// ─── Internal connection logic ────────────────────────────────────────────────

function openConnection(): void {
    const token = authService.getToken();

    if (!token) {
        console.warn('⚠️ WS: No JWT available, not connecting.');
        onStatus('disconnected');
        return;
    }

    // Client-side expiry check before attempting connection
    if (isJwtExpired(token)) {
        console.warn('⚠️ WS: JWT expired, triggering re-auth...');
        onStatus('auth-failed');
        onReAuth()
            .then(() => { if (!destroyed) openConnection(); })
            .catch(err => {
                console.error('❌ WS: Re-auth failed:', err?.message ?? err);
                onStatus('disconnected');
            });
        return;
    }

    const wsUrl = buildWsUrl(authService.getApiBaseUrl());
    console.log(`🔌 WS: Connecting to ${wsUrl} ...`);
    onStatus('connecting');

    ws = new WebSocket(wsUrl);

    ws.on('open', () => {
        console.log('🔌 WS: Open — sending auth...');
        currentDelay = MIN_DELAY; // reset backoff on successful open
        ws!.send(JSON.stringify({ type: 'auth', jwt: authService.getToken() }));
    });

    ws.on('message', (data: WebSocket.RawData) => {
        let msg: Record<string, unknown>;
        try {
            msg = JSON.parse(data.toString()) as Record<string, unknown>;
        } catch {
            console.warn('⚠️ WS: Non-JSON message received, ignoring.');
            return;
        }

        if (msg['type'] === 'auth_ok') {
            console.log(`✅ WS: auth_ok — peerId: ${msg['peerId'] ?? '?'}`);
            onStatus('connected', msg['peerId'] as string | undefined);
        }

        // Route every message to the registered external handler
        onMessage?.(msg);
    });

    ws.on('close', (code: number) => {
        console.log(`🔌 WS: Closed with code ${code}`);
        ws = null;
        if (destroyed) return;

        switch (code) {
            case CODE_JWT_INVALID:
                // Server rejected the JWT — re-auth then reconnect
                console.warn('⚠️ WS: JWT rejected by server (4002), re-authing...');
                onStatus('auth-failed');
                onReAuth()
                    .then(() => { if (!destroyed) scheduleReconnect(); })
                    .catch(err => {
                        console.error('❌ WS: Re-auth failed:', err?.message ?? err);
                        onStatus('disconnected');
                    });
                break;

            case CODE_WRONG_ROLE:
                // Fatal — wrong role, no point reconnecting
                console.error('❌ WS: Wrong role (4003). Not reconnecting.');
                onStatus('disconnected');
                break;

            case CODE_INVALID_JSON:
            case CODE_NO_AUTH_FIRST:
            case CODE_REPLACED:
            case CODE_DB_ERROR:
            default:
                // All other cases: reconnect with exponential backoff
                scheduleReconnect();
                break;
        }
    });

    ws.on('error', (err: Error) => {
        // 'close' fires after 'error', reconnect logic lives there
        console.error('❌ WS Error:', err.message);
    });
}

function scheduleReconnect(): void {
    onStatus('disconnected');
    console.log(`🔄 WS: Reconnecting in ${currentDelay / 1000}s...`);

    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!destroyed) openConnection();
    }, currentDelay);

    // Exponential backoff, capped at MAX_DELAY
    currentDelay = Math.min(currentDelay * 2, MAX_DELAY);
}
