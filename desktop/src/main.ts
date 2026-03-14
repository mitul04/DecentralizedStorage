import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import axios from 'axios';
import * as os from 'os';

import * as walletService from './services/walletService';
import * as ethService from './services/ethService';
import * as authService from './services/authService';
import * as wsService from './services/wsService';
import * as chunkService from './services/chunkService';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getLocalIP(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]!) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// ─── Configuration ───────────────────────────────────────────────────────────

const SERVER_PORT = 4000;
// Legacy node-coordinator URL (used for heartbeat / registration)
const COORDINATOR_URL = 'http://127.0.0.1:3000';
// TODO: replace with the Sepolia-deployed NodeRegistry address once available
const NODE_REGISTRY_ADDR = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';

// ─── State ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let wallet: ethers.HDNodeWallet | ethers.Wallet | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let coordinatorToken: string | null = null;

let nodeSettings = {
    capacity: '0',
    endpoint: `http://${getLocalIP()}:${SERVER_PORT}`,
};

// ─── UI helper ───────────────────────────────────────────────────────────────

function sendToUI(channel: string, data?: unknown): void {
    mainWindow?.webContents.send(channel, data);
}

// ─── Balance / wallet-connected ──────────────────────────────────────────────

async function pushBalances(): Promise<void> {
    if (!wallet || !mainWindow) return;

    const provider = ethService.createProvider();

    try {
        const [ethBal, dcldBal] = await Promise.all([
            ethService.getETHBalance(wallet.address, provider),
            ethService.getDCLDBalance(wallet.address, provider).catch(() => '0'),
        ]);

        // Check on-chain registration (best-effort — contract may not be on Sepolia yet)
        let isRegistered = false;
        try {
            const registryAbi = [
                'function nodes(address) view returns (string, uint256, uint256, uint256, uint256, bool, bool)',
            ];
            const registry = new ethers.Contract(NODE_REGISTRY_ADDR, registryAbi, provider);
            const profile = await (registry as any).nodes(wallet.address);
            isRegistered = profile[6] as boolean;
        } catch {
            // contract not reachable on Sepolia → ignore
        }

        sendToUI('wallet-connected', {
            address: wallet.address,
            eth: parseFloat(ethBal).toFixed(4),
            dcld: parseFloat(dcldBal).toFixed(4),
            isRegistered,
        });
    } catch (err) {
        console.error('❌ Balance fetch failed:', err);
    }
}

// ─── Node-coordinator auth + heartbeat (legacy) ──────────────────────────────

async function authenticateWithCoordinator(): Promise<boolean> {
    if (!wallet) return false;
    try {
        const nonceRes = await axios.post(`${COORDINATOR_URL}/auth/nonce`, {
            wallet_address: wallet.address,
        });
        const nonce: string = nonceRes.data.nonce;
        const signature = await wallet.signMessage(nonce);

        const verifyRes = await axios.post(`${COORDINATOR_URL}/auth/verify`, {
            wallet_address: wallet.address,
            nonce,
            signature,
            mode: 'LOGIN',
            role: 'STORAGE_PEER',
            os_type: 'LINUX',
            declared_capacity: parseInt(nodeSettings.capacity) || 100,
        });
        coordinatorToken = verifyRes.data.token;
        return true;
    } catch (err: any) {
        const msg: string = err?.response?.data?.error ?? err.message;
        if (msg === 'Storage peer not registered') {
            // First run — retry as REGISTER
            try {
                const nonceRes = await axios.post(`${COORDINATOR_URL}/auth/nonce`, {
                    wallet_address: wallet.address,
                });
                const nonce: string = nonceRes.data.nonce;
                const signature = await wallet.signMessage(nonce);
                const verifyRes = await axios.post(`${COORDINATOR_URL}/auth/verify`, {
                    wallet_address: wallet.address,
                    nonce,
                    signature,
                    mode: 'REGISTER',
                    role: 'STORAGE_PEER',
                    os_type: 'LINUX',
                    declared_capacity: parseInt(nodeSettings.capacity) || 100,
                });
                coordinatorToken = verifyRes.data.token;
                return true;
            } catch {
                return false;
            }
        }
        console.error('❌ Coordinator auth failed:', msg);
        return false;
    }
}

async function sendHeartbeat(address: string): Promise<void> {
    if (!coordinatorToken) return;
    try {
        await axios.post(
            `${COORDINATOR_URL}/api/nodes/heartbeat`,
            {
                walletAddress: address,
                ipAddress: `http://${getLocalIP()}:${SERVER_PORT}`,
                freeCapacity: nodeSettings.capacity + 'GB',
                timestamp: Date.now(),
            },
            { headers: { Authorization: `Bearer ${coordinatorToken}` } },
        );
    } catch (err: any) {
        console.log('⚠️ Heartbeat failed:', err?.response?.data?.error ?? 'Coordinator offline');
    }
}

function startHeartbeat(address: string): void {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    sendHeartbeat(address);
    heartbeatInterval = setInterval(() => sendHeartbeat(address), 30_000);
}

// ─── Shared post-auth hook ────────────────────────────────────────────────────

function onAuthSuccess(): void {
    sendToUI('auth-success');
    wsService.start();
    ensureDcldApproval().catch(err =>
        console.warn('⚠️ DCLD approval check failed:', err?.message ?? err)
    );
}

// Approve the StorageEscrow contract to spend DCLD on behalf of this peer.
// Called automatically after auth — peer must have sufficient allowance to participate in deals.
async function ensureDcldApproval(): Promise<void> {
    const escrowAddress = process.env.ESCROW_CONTRACT_ADDRESS ?? ethService.ESCROW_CONTRACT_ADDR;
    if (!wallet) return;

    const provider = ethService.createProvider();
    const signer   = wallet.connect(provider);

    const tokenAbi = ['function approve(address spender, uint256 amount) returns (bool)'];
    const token = new ethers.Contract(ethService.DCLD_TOKEN_ADDR, tokenAbi, signer);

    console.log(`⚠️ Approving DCLD escrow spending (MaxUint256)…`);
    const tx = await (token as any).approve(escrowAddress, ethers.MaxUint256, { gasLimit: 100_000 });
    await tx.wait(1);
    console.log(`✅ DCLD approved for escrow. tx: ${tx.hash}`);
    sendToUI('peer:approval', { status: 'approved', txHash: tx.hash });
}

// ─── Core wallet init (called after create/import/auto-load) ─────────────────

async function initWallet(loadedWallet: ethers.HDNodeWallet | ethers.Wallet): Promise<void> {
    wallet = loadedWallet;
    authService.setWallet(wallet); // expose to chunkService for deal signing
    console.log(`✅ Wallet ready: ${wallet.address}`);

    // Try auto-login on startup (non-fatal — renderer shows login/register choice on failure)
    authService.login(wallet)
        .then(() => onAuthSuccess())
        .catch(err => {
            console.warn('⚠️ DeCloud auto-login failed:', err?.message ?? err);
            sendToUI('auth-failed', (err?.message as string) ?? 'Login failed');
        });

    // Node-coordinator auth + heartbeat (non-fatal)
    authenticateWithCoordinator()
        .then(ok => { if (ok) startHeartbeat(wallet!.address); })
        .catch(err => console.warn('⚠️ Coordinator auth error:', err?.message));

    // Push balances to renderer
    await pushBalances();
}

// ─── Express server ──────────────────────────────────────────────────────────

function startServer(): void {
    const server = express();
    server.use(cors());
    server.use(express.json());

    server.get('/', (_req, res) => {
        res.send('Desktop Node is Online & Ready.');
    });

    server.listen(SERVER_PORT, '0.0.0.0', () => {
        console.log(`✅ Node server running on port ${SERVER_PORT}`);
        sendToUI('server-status', { status: '🟢 Online', color: 'green' });
    });
}

// ─── Electron window ─────────────────────────────────────────────────────────

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 720,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    mainWindow.loadFile(path.join(__dirname, '../src/index.html'));

    mainWindow.webContents.on('did-finish-load', () => {
        // Auto-load persisted wallet
        if (walletService.hasWallet()) {
            const provider = ethService.createProvider();
            const loaded = walletService.loadWallet(provider);
            if (loaded) {
                initWallet(loaded).catch(console.error);
                return;
            }
        }
        // No wallet stored — renderer shows create/import UI by default
        sendToUI('no-wallet');
    });
}

// ─── IPC: Auth retry ─────────────────────────────────────────────────────────

ipcMain.handle('peer-login', async () => {
    if (!wallet) throw new Error('No wallet connected.');
    await authService.login(wallet);
    onAuthSuccess();
});

ipcMain.handle('peer-register', async (_event, data: { declaredCapacityGB: number }) => {
    if (!wallet) throw new Error('No wallet connected.');
    const rawOS = os.platform();
    const osType =
        rawOS === 'win32'  ? 'Windows' :
        rawOS === 'darwin' ? 'MacOS'   :
        rawOS === 'linux'  ? 'Linux'   : rawOS;
    await authService.register(wallet, osType, data.declaredCapacityGB);
    onAuthSuccess();
});

ipcMain.handle('peer-logout', async () => {
    wsService.stop();
    authService.clearToken();
    sendToUI('auth-failed');
});

// ─── IPC: Wallet ─────────────────────────────────────────────────────────────

ipcMain.handle('create-wallet', async () => {
    const { mnemonic, address } = walletService.createWallet();
    const provider = ethService.createProvider();
    const loaded = walletService.loadWallet(provider)!;
    // Auth + balance push in background — renderer shows mnemonic first
    initWallet(loaded).catch(console.error);
    return { mnemonic, address };
});

ipcMain.handle('import-wallet', async (_event, mnemonic: string) => {
    // Throws on invalid mnemonic — renderer catches via invoke rejection
    const { address } = walletService.importWallet(mnemonic);
    const provider = ethService.createProvider();
    const loaded = walletService.loadWallet(provider)!;
    initWallet(loaded).catch(console.error);
    return { address };
});

// ─── IPC: Settings ───────────────────────────────────────────────────────────

ipcMain.handle('get-settings', () => {
    return {
        apiBaseUrl: authService.getApiBaseUrl(),
        relayBaseUrl: authService.getRelayBaseUrl(),
    };
});

ipcMain.handle('save-settings', (_event, data: { apiBaseUrl: string; relayBaseUrl?: string }) => {
    authService.setApiBaseUrl(data.apiBaseUrl);
    if (data.relayBaseUrl !== undefined) authService.setRelayBaseUrl(data.relayBaseUrl);
    return { ok: true };
});

// ─── IPC: Storage ─────────────────────────────────────────────────────────────

ipcMain.handle('get-storage-stats', () => chunkService.getStorageStats());
ipcMain.handle('get-assignments', () => chunkService.getAssignments());

// ─── IPC: Deal management ─────────────────────────────────────────────────────

ipcMain.handle('get-deal-settings', () => ({
    autoSign: authService.getPeerDealAutoSign(),
}));

ipcMain.handle('save-deal-settings', (_event, data: { autoSign: boolean }) => {
    authService.setPeerDealAutoSign(data.autoSign);
    return { ok: true };
});

ipcMain.handle('get-pending-deals', () => chunkService.getPendingDeals());

ipcMain.handle('approve-deal', async (_event, dealId: string) => {
    await chunkService.approveDeal(dealId);
    return { ok: true };
});

ipcMain.handle('reject-deal', (_event, dealId: string) => {
    chunkService.rejectDeal(dealId);
    return { ok: true };
});

// ─── IPC: DCLD approval ──────────────────────────────────────────────────────

ipcMain.handle('approve-dcld-escrow', async () => {
    if (!wallet) throw new Error('No wallet loaded — restart the app and try again.');

    const escrowAddress = process.env.ESCROW_CONTRACT_ADDRESS ?? ethService.ESCROW_CONTRACT_ADDR;
    const provider = ethService.createProvider();
    const signer   = wallet.connect(provider);

    const tokenAbi = ['function approve(address spender, uint256 amount) returns (bool)'];
    const token = new ethers.Contract(ethService.DCLD_TOKEN_ADDR, tokenAbi, signer);

    let tx: any;
    try {
        tx = await (token as any).approve(escrowAddress, ethers.MaxUint256, { gasLimit: 100_000 });
    } catch (err: any) {
        const msg: string = err?.message ?? '';
        if (msg.includes('insufficient funds') || msg.includes('insufficient balance'))
            throw new Error('Not enough ETH for gas fees — top up your wallet with Sepolia ETH and retry.');
        if (msg.includes('user rejected') || msg.includes('ACTION_REJECTED'))
            throw new Error('Transaction rejected.');
        if (msg.includes('nonce'))
            throw new Error('Nonce mismatch — another transaction may be pending. Wait a moment and retry.');
        if (msg.includes('network') || msg.includes('NETWORK_ERROR') || msg.includes('timeout'))
            throw new Error('Network error — check your internet connection and retry.');
        throw new Error(`Failed to send transaction: ${msg || 'unknown error'}`);
    }

    try {
        await tx.wait(1);
    } catch (err: any) {
        const msg: string = err?.message ?? '';
        if (msg.includes('reverted'))
            throw new Error(`Contract rejected the approval on-chain. Tx: ${tx.hash}`);
        throw new Error(`Transaction sent (${tx.hash}) but confirmation failed: ${msg}`);
    }

    console.log(`✅ DCLD manually approved for escrow. tx: ${tx.hash}`);
    sendToUI('peer:approval', { status: 'approved', txHash: tx.hash });
    return { status: 'approved', txHash: tx.hash };
});

// ─── IPC: Balance refresh ────────────────────────────────────────────────────

ipcMain.on('refresh-balance', () => {
    pushBalances().catch(console.error);
});

// ─── IPC: Node Registration ──────────────────────────────────────────────────

ipcMain.on('register-node', async (event, data: { capacity: string; endpoint: string }) => {
    if (!wallet) { event.reply('registration-error', 'Wallet not connected.'); return; }

    nodeSettings.capacity = data.capacity;
    nodeSettings.endpoint = data.endpoint;

    try {
        const provider = ethService.createProvider();
        const signer = wallet.connect(provider);

        const tokenAbi = [
            'function approve(address, uint256) returns (bool)',
            'function allowance(address, address) view returns (uint256)',
        ];
        const registryAbi = [
            'function registerNode(string ipAddress, uint256 capacity, bool isMobile)',
        ];

        const tokenContract = new ethers.Contract(ethService.DCLD_TOKEN_ADDR, tokenAbi, signer);
        const registryContract = new ethers.Contract(NODE_REGISTRY_ADDR, registryAbi, signer);

        const allowance: bigint = await (tokenContract as any).allowance(wallet.address, NODE_REGISTRY_ADDR);
        if (allowance < ethers.parseEther('500')) {
            console.log('⚠️ Approving 1000 DCLD...');
            const txApprove = await (tokenContract as any).approve(NODE_REGISTRY_ADDR, ethers.parseEther('1000'));
            await txApprove.wait();
        }

        const capacityBytes = BigInt(data.capacity) * BigInt('1073741824');
        const txReg = await (registryContract as any).registerNode(data.endpoint, capacityBytes, false, {
            gasLimit: 500_000,
        });
        await txReg.wait();

        console.log('✅ Node registered!');
        event.reply('registration-success', txReg.hash);
    } catch (err: any) {
        const msg: string = err.message ?? '';
        if (msg.toLowerCase().includes('registered')) {
            event.reply('registration-success', 'Already Registered');
        } else {
            event.reply('registration-error', msg);
        }
    }
});

ipcMain.on('update-ip', async (event, data: { endpoint: string }) => {
    if (!wallet) { event.reply('registration-error', 'Wallet not connected.'); return; }

    try {
        const provider = ethService.createProvider();
        const signer = wallet.connect(provider);
        const registryAbi = ['function updateIpAddress(string _newIp)'];
        const registry = new ethers.Contract(NODE_REGISTRY_ADDR, registryAbi, signer);

        const tx = await (registry as any).updateIpAddress(data.endpoint);
        await tx.wait();
        event.reply('update-success', tx.hash);
    } catch (err: any) {
        event.reply('registration-error', err.message ?? 'Unknown error');
    }
});

ipcMain.on('deregister-node', async event => {
    if (!wallet) { event.reply('registration-error', 'Wallet not connected.'); return; }

    try {
        const provider = ethService.createProvider();
        const signer = wallet.connect(provider);
        const registryAbi = ['function deregisterNode()'];
        const registry = new ethers.Contract(NODE_REGISTRY_ADDR, registryAbi, signer);

        const tx = await (registry as any).deregisterNode();
        await tx.wait();
        event.reply('deregister-success', tx.hash);
    } catch (err: any) {
        event.reply('registration-error', err.message ?? 'Unknown error');
    }
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
    // Initialise chunk service — registers the WS message handler for chunk_assignment
    chunkService.init((event, data) => {
        if (event === 'assignment') sendToUI('peer:assignment', data);
        if (event === 'storage-update') sendToUI('peer:storage', data);
        if (event === 'download') sendToUI('peer:download', data);
        if (event === 'deal') sendToUI('peer:deal', data);
    });

    // Initialise WebSocket service before any window or auth flow
    wsService.init(
        (status, peerId) => sendToUI('ws-status', { status, peerId }),
        async () => {
            // Called by wsService when the JWT is expired mid-session
            if (!wallet) throw new Error('No wallet for re-auth');
            await authService.login(wallet);
            sendToUI('auth-success');
        },
    );

    createWindow();
    startServer();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    wsService.stop();
});
