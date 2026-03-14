import axios from 'axios';
import { ethers } from 'ethers';
import Store from 'electron-store';

const DEFAULT_API_URL = 'https://api.decloud.network';

interface SettingsSchema {
    apiBaseUrl: string;
    relayBaseUrl: string;
    storageBaseDir: string;
    token: string;
    peerDealAutoSign: boolean;
}

const settingsStore = new Store<SettingsSchema>({ name: 'settings' });

// ─── Settings ─────────────────────────────────────────────────────────────────

export function getApiBaseUrl(): string {
    return settingsStore.has('apiBaseUrl')
        ? settingsStore.get('apiBaseUrl')
        : DEFAULT_API_URL;
}

export function setApiBaseUrl(url: string): void {
    settingsStore.set('apiBaseUrl', url);
}

export function getRelayBaseUrl(): string {
    return settingsStore.has('relayBaseUrl')
        ? settingsStore.get('relayBaseUrl')
        : getApiBaseUrl(); // default: same host as API
}

export function setRelayBaseUrl(url: string): void {
    settingsStore.set('relayBaseUrl', url);
}

export function getStorageBaseDir(): string {
    return settingsStore.has('storageBaseDir') ? settingsStore.get('storageBaseDir') : '';
}

export function setStorageBaseDir(dir: string): void {
    settingsStore.set('storageBaseDir', dir);
}

export function getPeerDealAutoSign(): boolean {
    return settingsStore.has('peerDealAutoSign') ? settingsStore.get('peerDealAutoSign') : true;
}

export function setPeerDealAutoSign(value: boolean): void {
    settingsStore.set('peerDealAutoSign', value);
}

// ─── Wallet (held in memory for deal signing) ────────────────────────────────

let _wallet: ethers.HDNodeWallet | ethers.Wallet | null = null;

export function setWallet(w: ethers.HDNodeWallet | ethers.Wallet): void {
    _wallet = w;
}

export function getWallet(): ethers.HDNodeWallet | ethers.Wallet | null {
    return _wallet;
}

// ─── Token ────────────────────────────────────────────────────────────────────

export function getToken(): string | undefined {
    return settingsStore.has('token') ? settingsStore.get('token') : undefined;
}

export function clearToken(): void {
    settingsStore.delete('token');
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function fetchNonce(endpoint: string, walletAddress: string): Promise<string> {
    const res = await axios.get(endpoint, {
        data: { wallet_address: walletAddress },
        headers: { 'Content-Type': 'application/json' },
    });
    return res.data.nonce as string;
}

async function signNonce(
    wallet: ethers.HDNodeWallet | ethers.Wallet,
    nonce: string,
): Promise<string> {
    return wallet.signMessage(nonce);
}

// ─── Login: GET /peer/login → POST /peer/login ────────────────────────────────

export async function login(wallet: ethers.HDNodeWallet | ethers.Wallet): Promise<string> {
    const base = getApiBaseUrl();
    const address = wallet.address;

    console.log(`🔐 Login: requesting nonce for ${address}...`);
    const nonce = await fetchNonce(`${base}/peer/login`, address);

    console.log(`✍️  Signing nonce...`);
    const signature = await signNonce(wallet, nonce);

    console.log(`🔑 Verifying...`);
    const res = await axios.post(`${base}/peer/login`, {
        wallet_address: address,
        nonce,
        signature,
    });

    const token = res.data.token as string;
    settingsStore.set('token', token);
    console.log(`✅ Login success.`);
    return token;
}

// ─── Register: GET /peer/register → POST /peer/register ──────────────────────

export async function register(
    wallet: ethers.HDNodeWallet | ethers.Wallet,
    osType: string,
    declaredCapacityGB: number,
): Promise<string> {
    const base = getApiBaseUrl();
    const address = wallet.address;

    console.log(`📝 Register: requesting nonce for ${address}...`);
    const nonce = await fetchNonce(`${base}/peer/register`, address);

    console.log(`✍️  Signing nonce...`);
    const signature = await signNonce(wallet, nonce);

    console.log(`🔑 Registering...`);
    const res = await axios.post(`${base}/peer/register`, {
        wallet_address: address,
        nonce,
        signature,
        os_type: osType,
        declared_capacity: declaredCapacityGB,
    });

    const token = res.data.token as string;
    settingsStore.set('token', token);
    console.log(`✅ Register success.`);
    return token;
}
