import { ethers } from 'ethers';

export const SEPOLIA_RPC = 'https://sepolia.infura.io/v3/eaea60d233f64893b5926f90422b7b78';
export const DCLD_TOKEN_ADDR = '0x1702e56a169517e8EFf510DFBF2579Cf1d94621A';

const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
];

export function createProvider(): ethers.JsonRpcProvider {
    return new ethers.JsonRpcProvider(SEPOLIA_RPC);
}

/**
 * Fetch the DCLD ERC-20 balance for an address.
 * Uses decimals() to format the raw value correctly.
 */
export async function getDCLDBalance(
    address: string,
    provider: ethers.JsonRpcProvider,
): Promise<string> {
    const token = new ethers.Contract(DCLD_TOKEN_ADDR, ERC20_ABI, provider);
    const [raw, decimals]: [bigint, bigint] = await Promise.all([
        (token as any).balanceOf(address),
        (token as any).decimals(),
    ]);
    return ethers.formatUnits(raw, decimals);
}

/**
 * Fetch the native ETH balance for an address.
 */
export async function getETHBalance(
    address: string,
    provider: ethers.JsonRpcProvider,
): Promise<string> {
    const wei = await provider.getBalance(address);
    return ethers.formatEther(wei);
}
