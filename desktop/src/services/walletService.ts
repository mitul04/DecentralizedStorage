import { ethers } from 'ethers';
import Store from 'electron-store';

const DERIVATION_PATH = "m/44'/60'/0'/0/0";
// App-level encryption key for the on-disk wallet store
const STORE_ENCRYPTION_KEY = 'decloud-wallet-enc-v1';

interface WalletSchema {
    mnemonic: string;
    address: string;
}

const walletStore = new Store<WalletSchema>({
    name: 'wallet',
    encryptionKey: STORE_ENCRYPTION_KEY,
});

/**
 * Generate a new 12-word BIP-39 mnemonic, derive the wallet at BIP-44
 * path m/44'/60'/0'/0/0, and persist it encrypted.
 */
export function createWallet(): { mnemonic: string; address: string } {
    const entropy = ethers.randomBytes(16); // 128 bits → 12-word mnemonic
    const mnemonic = ethers.Mnemonic.entropyToPhrase(entropy);
    const hdWallet = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, DERIVATION_PATH);

    walletStore.set('mnemonic', mnemonic);
    walletStore.set('address', hdWallet.address);

    return { mnemonic, address: hdWallet.address };
}

/**
 * Validate a BIP-39 mnemonic, derive the wallet, and persist it encrypted.
 * Throws if the mnemonic is invalid.
 */
export function importWallet(mnemonicPhrase: string): { address: string } {
    const trimmed = mnemonicPhrase.trim();

    if (!ethers.Mnemonic.isValidMnemonic(trimmed)) {
        throw new Error('Invalid mnemonic phrase. Please check your 12 words and try again.');
    }

    const hdWallet = ethers.HDNodeWallet.fromPhrase(trimmed, undefined, DERIVATION_PATH);

    walletStore.set('mnemonic', trimmed);
    walletStore.set('address', hdWallet.address);

    return { address: hdWallet.address };
}

/**
 * Load the persisted wallet and attach it to the given provider.
 * Returns null if no wallet has been saved yet.
 */
export function loadWallet(provider: ethers.JsonRpcProvider): ethers.HDNodeWallet | null {
    if (!walletStore.has('mnemonic')) return null;
    const mnemonic = walletStore.get('mnemonic');
    const hd = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, DERIVATION_PATH);
    return hd.connect(provider) as ethers.HDNodeWallet;
}

export function getSavedAddress(): string | undefined {
    return walletStore.has('address') ? walletStore.get('address') : undefined;
}

export function hasWallet(): boolean {
    return walletStore.has('mnemonic');
}

export function clearWallet(): void {
    walletStore.clear();
}
