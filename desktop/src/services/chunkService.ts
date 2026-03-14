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
    reservedBytes: number;
}

export interface StorageStats {
    usedBytes: number;
    chunkCount: number;
}

interface AssignmentStoreSchema {
    assignments: ChunkAssignment[];
}

// Relay protocol state machine states — upload (peer receives)
type RelayState =
    | 'waiting_paired'
    | 'waiting_chunk_start'
    | 'waiting_binary'
    | 'waiting_chunk_end'
    | 'done';


interface ChunkMeta {
    chunkIndex: number;
    size: number;
    hash: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Fallback reservation per chunk when no prior data exists to derive an average from. */
const DEFAULT_BYTES_PER_CHUNK = 1024 * 1024; // 1 MiB

// ─── Persistent store ─────────────────────────────────────────────────────────

const assignmentStore = new Store<AssignmentStoreSchema>({
    name: 'chunk-assignments',
    defaults: { assignments: [] },
});

// ─── Event callback (→ main.ts → renderer) ───────────────────────────────────

type ChunkEventCallback = (event: 'assignment' | 'storage-update' | 'download' | 'deal', data: unknown) => void;

// ─── Manual deal approval queue ───────────────────────────────────────────────

export interface PendingApproval {
    dealId: string;
    dealData: Record<string, unknown>;
    expiresAt: number;
}

interface PendingApprovalEntry extends PendingApproval {
    resolve: () => Promise<void>;
    timeoutHandle: ReturnType<typeof setTimeout>;
}

const pendingDeals = new Map<string, PendingApprovalEntry>();

export function getPendingDeals(): PendingApproval[] {
    return Array.from(pendingDeals.values()).map(({ dealId, dealData, expiresAt }) => ({
        dealId,
        dealData,
        expiresAt,
    }));
}

export async function approveDeal(dealId: string): Promise<void> {
    const entry = pendingDeals.get(dealId);
    if (!entry) throw new Error(`No pending deal: ${dealId}`);
    clearTimeout(entry.timeoutHandle);
    pendingDeals.delete(dealId);
    await entry.resolve();
}

export function rejectDeal(dealId: string): void {
    const entry = pendingDeals.get(dealId);
    if (!entry) return;
    clearTimeout(entry.timeoutHandle);
    pendingDeals.delete(dealId);
    onEvent('deal', { phase: 'rejected', dealId });
    console.log(`🚫 Deal ${dealId.slice(0, 12)}… rejected by peer`);
}

let onEvent: ChunkEventCallback = () => {};

// ─── Storage path ─────────────────────────────────────────────────────────────

function storageBaseDir(): string {
    const configured = authService.getStorageBaseDir();
    return configured || path.join(app.getPath('userData'), 'storage');
}

function chunkFilePath(fileId: string, chunkIndex: number): string {
    return path.join(storageBaseDir(), fileId, `${chunkIndex}.bin`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function init(eventCb: ChunkEventCallback): void {
    onEvent = eventCb;

    wsService.setMessageHandler((msg) => {
        if (msg['type'] === 'chunk_assignment') {
            const token        = msg['token'] as string;
            const fileId       = msg['fileId'] as string;
            const chunkIndexes = msg['chunkIndexes'] as number[];
            // relayUrl is optional — server may send it directly in the message
            const relayUrl     = msg['relayUrl'] as string | undefined;
            if (token && fileId && Array.isArray(chunkIndexes)) {
                handleAssignment(token, fileId, chunkIndexes, relayUrl);
            }

        } else if (msg['type'] === 'cancel_assignment') {
            const token  = msg['token'] as string;
            const fileId = msg['fileId'] as string;
            if (token && fileId) {
                cancelAssignment(token);
            }

        } else if (msg['type'] === 'chunk_download_request') {
            const token      = msg['token']      as string;
            const fileId     = msg['fileId']     as string;
            const chunkIndex = msg['chunkIndex'] as number;
            const relayUrl   = msg['relayUrl']   as string | undefined;
            if (token && fileId && typeof chunkIndex === 'number') {
                handleDownloadRequest(token, fileId, chunkIndex, relayUrl);
            }

        } else if (msg['type'] === 'deal_signing_request') {
            handleDealSigningRequest(msg as Record<string, unknown>).catch((err: Error) => {
                console.error(`❌ Deal signing failed: ${err.message}`);
            });

        } else if (msg['type'] === 'proof_challenge') {
            const dealId   = msg['dealId']   as string;
            const interval = msg['interval'] as number;
            const nonce    = msg['nonce']    as string;
            if (dealId && interval && nonce) {
                handleProofChallenge(dealId, interval, nonce).catch((err: Error) => {
                    console.error(`❌ Proof challenge failed: ${err.message}`);
                });
            }
        }
    });
}

export function getAssignments(): ChunkAssignment[] {
    return assignmentStore.get('assignments');
}

export function getStorageStats(): StorageStats {
    const dir = storageBaseDir();
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
                } catch { /* skip */ }
            }
        }
    } catch { /* dir may not exist */ }

    return { usedBytes, chunkCount };
}

// ─── Assignment handling ──────────────────────────────────────────────────────

function estimateReservedBytes(chunkCount: number): number {
    const stats = getStorageStats();
    const avgSize = stats.chunkCount > 0
        ? Math.round(stats.usedBytes / stats.chunkCount)
        : DEFAULT_BYTES_PER_CHUNK;
    return chunkCount * avgSize;
}

function handleAssignment(token: string, fileId: string, chunkIndexes: number[], relayUrl?: string): void {
    console.log(`📦 Assignment — fileId=${fileId} chunks=[${chunkIndexes}] token=${token.slice(0, 8)}...`);

    const reservedBytes = estimateReservedBytes(chunkIndexes.length);
    const list = assignmentStore.get('assignments');
    list.push({ token, fileId, chunkIndexes, receivedAt: Date.now(), status: 'pending', reservedBytes });
    assignmentStore.set('assignments', list);
    console.log(`📐 Reserved ~${(reservedBytes / 1024 / 1024).toFixed(1)} MiB for ${chunkIndexes.length} chunk(s)`);

    // ACK immediately — server times out in 5 s
    const sent = wsService.send(JSON.stringify({ type: 'chunk_assignment_ack', token }));
    console.log(sent
        ? `✅ ACK sent — token=${token.slice(0, 8)}...`
        : '⚠️ ACK failed: main WS not open');

    onEvent('assignment', { token, fileId, chunkIndexes });

    connectToRelay(token, fileId, relayUrl).catch(err => {
        console.error(`❌ Relay failed — token=${token.slice(0, 8)}:`, err.message);
        updateStatus(token, 'failed');
    });
}

function cancelAssignment(token: string): void {
    console.log(`🚫 cancel_assignment — token=${token.slice(0, 8)}...`);
    const list = assignmentStore.get('assignments');
    const idx = list.findIndex(a => a.token === token && a.status === 'pending');
    if (idx === -1) {
        console.warn(`⚠️ cancel_assignment: no pending entry for token=${token.slice(0, 8)}`);
        return;
    }
    const removed = list.splice(idx, 1)[0]!;
    assignmentStore.set('assignments', list);
    console.log(`✅ Reserved space released (~${(removed.reservedBytes / 1024 / 1024).toFixed(1)} MiB) — token=${token.slice(0, 8)}...`);
}

function handleDownloadRequest(token: string, fileId: string, chunkIndex: number, relayUrl?: string): void {
    console.log(`📤 Download request — fileId=${fileId} chunk=${chunkIndex} token=${token.slice(0, 8)}...`);
    onEvent('download', { phase: 'requested', fileId, chunkIndex });
    connectToRelayForDownload(token, fileId, chunkIndex, relayUrl).catch((err: Error) => {
        console.warn(`⚠️ Download relay failed — chunk=${chunkIndex} token=${token.slice(0, 8)}: ${err.message}`);
        onEvent('download', { phase: 'failed', fileId, chunkIndex, error: err.message });
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

async function connectToRelay(token: string, fileId: string, relayUrl?: string): Promise<void> {
    const url = buildRelayUrl(relayUrl || authService.getRelayBaseUrl());
    console.log(`🔌 Relay: → ${url}  token=${token.slice(0, 8)}...`);

    return new Promise<void>((resolve, reject) => {
        const relay = new WebSocket(url);

        let state: RelayState = 'waiting_paired';
        let currentMeta: ChunkMeta | null = null;
        let currentBuffer: Buffer | null = null;

        relay.on('open', () => {
            relay.send(JSON.stringify({ token, role: 'peer' }));
        });

        relay.on('message', async (data: WebSocket.RawData, isBinary: boolean) => {
            // ── Binary frame — must arrive between chunk_start and chunk_end ──
            if (isBinary) {
                if (state !== 'waiting_binary') {
                    console.warn(`⚠️ Relay: unexpected binary in state ${state}`);
                    return;
                }
                currentBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
                console.log(`📥 Binary chunk[${currentMeta!.chunkIndex}] — ${currentBuffer.length} bytes`);
                state = 'waiting_chunk_end';
                return;
            }

            // ── Text (JSON) frame ─────────────────────────────────────────────
            let msg: Record<string, unknown>;
            try {
                msg = JSON.parse(data.toString()) as Record<string, unknown>;
            } catch {
                console.warn('⚠️ Relay: non-JSON text frame');
                return;
            }

            const type = msg['type'] as string;

            switch (state) {

                case 'waiting_paired':
                    if (type === 'paired') {
                        console.log('🔌 Relay: paired — ready for chunks');
                        updateStatus(token, 'receiving'); // PENDING → ACTIVE
                        state = 'waiting_chunk_start';
                    }
                    break;

                case 'waiting_chunk_start':
                    if (type === 'chunk_start') {
                        currentMeta = {
                            chunkIndex: msg['chunkIndex'] as number,
                            size: msg['size'] as number,
                            hash: msg['hash'] as string,
                        };
                        console.log(`📦 chunk_start — index=${currentMeta.chunkIndex} size=${currentMeta.size}`);
                        state = 'waiting_binary';

                    } else if (type === 'transfer_complete') {
                        console.log('✅ Relay: transfer_complete');
                        state = 'done';
                        updateStatus(token, 'complete');
                        relay.close(1000, 'Transfer complete');
                        resolve();
                    }
                    break;

                case 'waiting_chunk_end':
                    if (type === 'chunk_end') {
                        const chunkIndex = msg['chunkIndex'] as number;

                        if (!currentMeta || !currentBuffer) {
                            reject(new Error('chunk_end with no pending chunk data'));
                            return;
                        }

                        // Verify SHA-256
                        const actualHash = crypto
                            .createHash('sha256')
                            .update(currentBuffer)
                            .digest('hex');

                        if (actualHash !== currentMeta.hash) {
                            console.error(
                                `❌ Hash mismatch chunk[${chunkIndex}]\n` +
                                `  expected: ${currentMeta.hash}\n` +
                                `  received: ${actualHash}`
                            );
                            relay.send(JSON.stringify({
                                type: 'chunk_error',
                                chunkIndex,
                                error: 'hash mismatch',
                            }));
                            relay.close(1008, 'Hash mismatch');
                            reject(new Error(`Hash mismatch for chunk ${chunkIndex}`));
                            return;
                        }

                        // Save to disk
                        try {
                            await saveChunk(fileId, chunkIndex, currentBuffer);
                        } catch (err: any) {
                            relay.send(JSON.stringify({
                                type: 'chunk_error',
                                chunkIndex,
                                error: 'disk write failed',
                            }));
                            relay.close(1011, 'Save error');
                            reject(err);
                            return;
                        }

                        // ACK relay
                        relay.send(JSON.stringify({ type: 'chunk_ack', chunkIndex }));

                        // Notify coordinator — best-effort, no ACK expected
                        wsService.send(JSON.stringify({
                            type: 'chunk_stored',
                            token,
                            fileId,
                            chunkIndex,
                        }));

                        console.log(`✅ chunk[${chunkIndex}] verified & saved`);

                        onEvent('storage-update', getStorageStats());

                        // Reset for next chunk
                        currentMeta = null;
                        currentBuffer = null;
                        state = 'waiting_chunk_start';
                    }
                    break;

                default:
                    break;
            }
        });

        relay.on('close', (code) => {
            if (state !== 'done') {
                updateStatus(token, 'failed');
                reject(new Error(`Relay closed unexpectedly (code ${code}) in state '${state}'`));
            }
        });

        relay.on('error', reject);
    });
}

const DOWNLOAD_BLOCK_SIZE  = 64 * 1024; // 64 KiB per binary frame
const PAIRED_TIMEOUT_MS    = 60_000;

async function connectToRelayForDownload(token: string, fileId: string, chunkIndex: number, relayUrl?: string): Promise<void> {
    const filePath = chunkFilePath(fileId, chunkIndex);
    if (!fs.existsSync(filePath)) {
        console.warn(`⚠️ Download: chunk not found on disk — ${filePath}`);
        return;
    }

    const base = buildRelayUrl(relayUrl || authService.getRelayBaseUrl());
    const url  = `${base}?token=${token}&chunkIndex=${chunkIndex}&role=peer`;
    console.log(`🔌 Relay (↑ send): → ${base}  chunk=${chunkIndex}  token=${token.slice(0, 8)}...`);

    const relay = new WebSocket(url);

    // ── Phase 1: wait for paired ──────────────────────────────────────────────
    try {
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                relay.close();
                reject(new Error('pairing timeout'));
            }, PAIRED_TIMEOUT_MS);

            relay.once('message', (raw: WebSocket.RawData) => {
                clearTimeout(timeout);
                let msg: Record<string, unknown>;
                try { msg = JSON.parse(raw.toString()) as Record<string, unknown>; }
                catch { relay.close(); reject(new Error('bad message')); return; }
                if (msg['type'] !== 'paired') {
                    relay.close();
                    reject(new Error(`expected paired, got ${String(msg['type'])}`));
                    return;
                }
                resolve();
            });

            relay.once('error', (e: Error) => { clearTimeout(timeout); reject(e); });
        });
    } catch (e: unknown) {
        console.warn(`⚠️ Relay (↑ send) pairing failed — chunk=${chunkIndex}: ${(e as Error).message}`);
        return;
    }

    console.log(`🔌 Relay (↑ send): paired — streaming chunk[${chunkIndex}]`);
    onEvent('download', { phase: 'streaming', fileId, chunkIndex });

    // ── Phase 2: stream chunk as fixed-size binary frames ─────────────────────
    try {
        const fd  = fs.openSync(filePath, 'r');
        const buf = Buffer.allocUnsafe(DOWNLOAD_BLOCK_SIZE);
        let bytesRead: number;

        while ((bytesRead = fs.readSync(fd, buf, 0, DOWNLOAD_BLOCK_SIZE, null)) > 0) {
            relay.send(bytesRead === DOWNLOAD_BLOCK_SIZE ? buf : buf.subarray(0, bytesRead));
        }

        fs.closeSync(fd);
        relay.send(JSON.stringify({ type: 'chunk_complete' }));
        relay.close(1000, 'Done');
        console.log(`✅ chunk[${chunkIndex}] streamed to client`);
        onEvent('download', { phase: 'complete', fileId, chunkIndex });
    } catch (err: unknown) {
        const errMsg = (err as Error).message;
        console.error(`❌ Relay (↑ send) stream error: ${errMsg}`);
        if (relay.readyState === WebSocket.OPEN) {
            relay.send(JSON.stringify({ type: 'error', message: errMsg }));
            relay.close(1011, 'Stream error');
        }
    }
}

// ─── Disk I/O ─────────────────────────────────────────────────────────────────

async function saveChunk(fileId: string, chunkIndex: number, data: Buffer): Promise<void> {
    const dest = chunkFilePath(fileId, chunkIndex);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.writeFile(dest, data);
    console.log(`💾 ${dest} (${data.length} bytes)`);
}

// ─── Deal signing ─────────────────────────────────────────────────────────────

// EIP-712 types — must match StorageEscrow.sol DEAL_TYPEHASH exactly
const DEAL_TYPES = {
    Deal: [
        { name: 'dealId',           type: 'bytes32'   },
        { name: 'fileId',           type: 'bytes32'   },
        { name: 'merkleRoot',       type: 'bytes32'   },
        { name: 'client',           type: 'address'   },
        { name: 'peer',             type: 'address'   },
        { name: 'size',             type: 'uint256'   },
        { name: 'duration',         type: 'uint256'   },
        { name: 'price',            type: 'uint256'   },
        { name: 'peerEscrowAmount', type: 'uint256'   },
        { name: 'chunkHashes',      type: 'bytes32[]' },
    ],
};

async function signAndPostDeal(msg: Record<string, unknown>): Promise<void> {
    const dealId        = msg['dealId']        as string;
    const escrowAddress = msg['escrowAddress'] as string;

    const wallet = authService.getWallet();
    if (!wallet) {
        console.warn('⚠️ signAndPostDeal — no wallet loaded');
        return;
    }

    const { ethers } = await import('ethers');

    const domain = {
        name:              'StorageEscrow',
        version:           '1',
        chainId:           BigInt(11155111), // Sepolia
        verifyingContract: ethers.getAddress(escrowAddress),
    };

    const dealValue = {
        dealId:           msg['dealId']        as string,
        fileId:           msg['fileId']        as string,
        merkleRoot:       msg['merkleRoot']     as string,
        client:           ethers.getAddress(msg['clientAddress'] as string),
        peer:             ethers.getAddress(msg['peerAddress']   as string),
        size:             BigInt(msg['sizeBytes']      as string),
        duration:         BigInt(msg['durationBlocks'] as string),
        price:            BigInt(msg['priceWei']       as string),
        peerEscrowAmount: BigInt(msg['peerEscrowWei']  as string),
        chunkHashes:      (msg['chunkHashes'] as string[]) ?? [],
    };

    let signature: string;
    try {
        signature = await wallet.signTypedData(domain, DEAL_TYPES, dealValue);
    } catch (err: unknown) {
        console.error(`❌ signTypedData failed: ${(err as Error).message}`);
        return;
    }

    const apiBase = authService.getApiBaseUrl();
    const token   = authService.getToken();
    try {
        const res = await fetch(`${apiBase}/peer/deals/${dealId}/sign`, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ signature }),
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`${res.status} ${body}`);
        }
        console.log(`✅ Deal ${dealId.slice(0, 12)}… signed and submitted`);
        onEvent('deal', { phase: 'signed', dealId });
    } catch (err: unknown) {
        console.error(`❌ Deal sign POST failed: ${(err as Error).message}`);
    }
}

async function handleDealSigningRequest(msg: Record<string, unknown>): Promise<void> {
    const dealId        = msg['dealId']        as string;
    const escrowAddress = msg['escrowAddress'] as string;

    if (!dealId || !escrowAddress) {
        console.warn('⚠️ deal_signing_request missing dealId or escrowAddress');
        return;
    }

    const wallet = authService.getWallet();
    if (!wallet) {
        console.warn('⚠️ deal_signing_request — no wallet loaded, cannot sign');
        return;
    }

    if (authService.getPeerDealAutoSign()) {
        // Auto mode: sign immediately (existing behaviour)
        console.log(`✍️  Auto-signing deal ${dealId.slice(0, 12)}…`);
        await signAndPostDeal(msg);
    } else {
        // Manual mode: queue for peer approval with 5-minute timeout
        const expiresAt = Date.now() + 5 * 60 * 1000;
        const timeoutHandle = setTimeout(() => {
            pendingDeals.delete(dealId);
            onEvent('deal', { phase: 'expired', dealId });
            console.log(`⏰ Deal ${dealId.slice(0, 12)}… expired without approval`);
        }, 5 * 60 * 1000);

        pendingDeals.set(dealId, {
            dealId,
            dealData: msg,
            expiresAt,
            resolve: () => signAndPostDeal(msg),
            timeoutHandle,
        });

        console.log(`⏳ Deal ${dealId.slice(0, 12)}… queued for manual approval`);
        onEvent('deal', { phase: 'pending_approval', dealId, dealData: msg, expiresAt });
    }
}

// ─── Storage proof challenge ──────────────────────────────────────────────────

async function handleProofChallenge(dealId: string, interval: number, nonce: string): Promise<void> {
    console.log(`🔍 Proof challenge — deal: ${dealId.slice(0, 12)}…  interval: ${interval}`);

    // Find which file/chunks are associated with this deal by looking at assignments
    // We derive the fileId from the assignment store using the dealId sent in the signing request.
    // Since we don't store dealId→fileId mapping, we read all chunk files from storage and hash them.
    // The coordinator links dealId → peer via peerWS, and we stored chunk files by fileId.
    // We need to find the relevant file. For now we scan the assignment store for context.
    // A more robust approach would persist dealId→fileId in a deal store.

    // Load chunk files by scanning storage directory
    const storageDir = storageBaseDir();
    if (!fs.existsSync(storageDir)) {
        console.warn('⚠️ Proof challenge — storage directory does not exist');
        return;
    }

    // Collect all chunk bytes across all stored files (sorted by fileId/chunkIndex for determinism)
    const chunkBuffers: Buffer[] = [];
    try {
        const fileDirs = fs.readdirSync(storageDir).sort();
        for (const fid of fileDirs) {
            const fileDir = path.join(storageDir, fid);
            if (!fs.statSync(fileDir).isDirectory()) continue;
            const chunks = fs.readdirSync(fileDir)
                .filter(f => f.endsWith('.bin'))
                .sort((a, b) => parseInt(a) - parseInt(b));
            for (const chunk of chunks) {
                chunkBuffers.push(fs.readFileSync(path.join(fileDir, chunk)));
            }
        }
    } catch (err: unknown) {
        console.error(`❌ Proof challenge — failed to read chunks: ${(err as Error).message}`);
        return;
    }

    // sha256(chunk_0_bytes || chunk_1_bytes || ... || nonce_bytes)
    const hasher = crypto.createHash('sha256');
    for (const buf of chunkBuffers) {
        hasher.update(buf);
    }
    hasher.update(Buffer.from(nonce, 'hex'));
    const hash = '0x' + hasher.digest('hex');

    wsService.send(JSON.stringify({ type: 'proof_response', dealId, interval, hash }));
    console.log(`📤 Proof response sent — interval: ${interval}  hash: ${hash.slice(0, 14)}…`);
    onEvent('deal', { phase: 'proof_sent', dealId, interval });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function updateStatus(token: string, status: ChunkAssignment['status']): void {
    const list = assignmentStore.get('assignments');
    assignmentStore.set('assignments', list.map(a => a.token === token ? { ...a, status } : a));
}
