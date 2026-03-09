import WebSocket from 'ws';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import Store from 'electron-store';

import * as authService from './authService';
import * as wsService from './wsService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChunkAssignment {
    token: string;
    fileId: string;
    chunkIndexes: number[];
    receivedAt: number;
    status: 'pending' | 'receiving' | 'complete' | 'failed';
}

export interface StorageStats {
    usedBytes: number;
    chunkCount: number;
}

interface AssignmentStoreSchema {
    assignments: ChunkAssignment[];
}

// ─── Persistent store ─────────────────────────────────────────────────────────

const assignmentStore = new Store<AssignmentStoreSchema>({
    name: 'chunk-assignments',
    defaults: { assignments: [] },
});

// ─── Event callback (→ main.ts → renderer) ───────────────────────────────────

type ChunkEventCallback = (event: 'assignment' | 'storage-update', data: unknown) => void;

let onEvent: ChunkEventCallback = () => {};

// ─── Paths ────────────────────────────────────────────────────────────────────

function storageDir(): string {
    return path.join(app.getPath('userData'), 'storage');
}

function chunkPath(fileId: string, chunkIndex: number): string {
    return path.join(storageDir(), fileId, `${chunkIndex}.bin`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call once from main.ts after app.whenReady().
 * Registers the message handler on wsService so chunk_assignment messages
 * are routed here automatically.
 */
export function init(eventCb: ChunkEventCallback): void {
    onEvent = eventCb;

    wsService.setMessageHandler((msg) => {
        if (msg['type'] === 'chunk_assignment') {
            const token        = msg['token'] as string;
            const fileId       = msg['fileId'] as string;
            const chunkIndexes = msg['chunkIndexes'] as number[];
            if (token && fileId && Array.isArray(chunkIndexes)) {
                handleAssignment(token, fileId, chunkIndexes);
            }
        }
    });
}

export function getAssignments(): ChunkAssignment[] {
    return assignmentStore.get('assignments');
}

export function getStorageStats(): StorageStats {
    const dir = storageDir();
    if (!fs.existsSync(dir)) return { usedBytes: 0, chunkCount: 0 };

    let usedBytes = 0;
    let chunkCount = 0;
    try {
        for (const fileId of fs.readdirSync(dir)) {
            const fileDir = path.join(dir, fileId);
            if (!fs.statSync(fileDir).isDirectory()) continue;
            for (const chunk of fs.readdirSync(fileDir)) {
                try {
                    usedBytes += fs.statSync(path.join(fileDir, chunk)).size;
                    chunkCount++;
                } catch { /* skip unreadable */ }
            }
        }
    } catch { /* storage dir may not exist yet */ }

    return { usedBytes, chunkCount };
}

// ─── Assignment handling ──────────────────────────────────────────────────────

function handleAssignment(token: string, fileId: string, chunkIndexes: number[]): void {
    console.log(`📦 Chunk assignment — fileId=${fileId} chunks=[${chunkIndexes}] token=${token.slice(0, 8)}...`);

    // Persist
    const list = assignmentStore.get('assignments');
    list.push({ token, fileId, chunkIndexes, receivedAt: Date.now(), status: 'pending' });
    assignmentStore.set('assignments', list);

    // ACK immediately — server times out after 5 s
    const sent = wsService.send(JSON.stringify({ type: 'chunk_assignment_ack', token }));
    console.log(sent
        ? `✅ ACK sent for token ${token.slice(0, 8)}...`
        : '⚠️ ACK could not be sent: main WS not open');

    // Notify renderer
    onEvent('assignment', { token, fileId, chunkIndexes });

    // Connect to relay in background
    connectToRelay(token, fileId, chunkIndexes).catch(err => {
        console.error(`❌ Relay error for token ${token.slice(0, 8)}:`, err.message);
        updateStatus(token, 'failed');
    });
}

// ─── Relay connection ─────────────────────────────────────────────────────────

function buildRelayUrl(base: string): string {
    return base
        .replace(/^https:\/\//, 'wss://')
        .replace(/^http:\/\//, 'ws://')
        .replace(/\/$/, '')
        + '/connect';
}

async function connectToRelay(
    token: string,
    fileId: string,
    chunkIndexes: number[],
): Promise<void> {
    const url = buildRelayUrl(authService.getRelayBaseUrl());
    console.log(`🔌 Relay: connecting to ${url} — token=${token.slice(0, 8)}...`);
    updateStatus(token, 'receiving');

    return new Promise<void>((resolve, reject) => {
        const relay = new WebSocket(url);

        let chunkCursor = 0;
        const received: number[] = [];
        let pendingHash: string | null = null;

        relay.on('open', () => {
            relay.send(JSON.stringify({ token, role: 'peer' }));
        });

        relay.on('message', async (data: WebSocket.RawData, isBinary: boolean) => {
            if (!isBinary) {
                // JSON metadata — may carry chunk_hash for the next binary frame
                try {
                    const meta = JSON.parse(data.toString()) as { chunk_hash?: string };
                    if (meta.chunk_hash) pendingHash = meta.chunk_hash;
                } catch { /* ignore malformed */ }
                return;
            }

            const idx = chunkIndexes[chunkCursor];
            if (idx === undefined) {
                console.warn('⚠️ Relay: received unexpected extra chunk — ignoring');
                return;
            }

            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            console.log(`📥 Relay: chunk[${idx}] — ${buf.length} bytes`);

            try {
                await saveChunk(fileId, idx, buf, pendingHash ?? undefined);
                pendingHash = null;
                received.push(idx);
                chunkCursor++;

                onEvent('storage-update', getStorageStats());

                if (chunkCursor >= chunkIndexes.length) {
                    relay.send(JSON.stringify({
                        type: 'chunks_received',
                        fileId,
                        chunkIndexes: received,
                    }));
                    console.log(`✅ All chunks received for fileId=${fileId}`);
                    updateStatus(token, 'complete');
                    relay.close(1000, 'All chunks received');
                    resolve();
                }
            } catch (err: any) {
                relay.close(1011, 'Save error');
                reject(err);
            }
        });

        relay.on('close', (code) => {
            if (chunkCursor < chunkIndexes.length) {
                updateStatus(token, 'failed');
                reject(new Error(
                    `Relay closed early (code ${code}): received ${chunkCursor}/${chunkIndexes.length} chunks`
                ));
            }
        });

        relay.on('error', reject);
    });
}

// ─── Chunk file I/O ───────────────────────────────────────────────────────────

async function saveChunk(
    fileId: string,
    chunkIndex: number,
    data: Buffer,
    expectedHash?: string,
): Promise<void> {
    const dest = chunkPath(fileId, chunkIndex);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.writeFile(dest, data);

    const hash = crypto.createHash('sha256').update(data).digest('hex');

    if (expectedHash) {
        if (hash !== expectedHash) {
            await fs.promises.unlink(dest).catch(() => {});
            throw new Error(
                `Hash mismatch for chunk ${chunkIndex}: expected ${expectedHash}, got ${hash}`
            );
        }
        console.log(`💾 Chunk ${chunkIndex} saved & verified ✅ (${data.length} bytes)`);
    } else {
        console.log(`💾 Chunk ${chunkIndex} saved (${data.length} bytes | sha256: ${hash.slice(0, 16)}… — no server hash to verify)`);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function updateStatus(token: string, status: ChunkAssignment['status']): void {
    const list = assignmentStore.get('assignments');
    assignmentStore.set('assignments', list.map(a => a.token === token ? { ...a, status } : a));
}
