import { ethers } from 'ethers';

export const SEPOLIA_RPC = 'https://sepolia.infura.io/v3/eaea60d233f64893b5926f90422b7b78';
export const DCLD_TOKEN_ADDR = '0xB157028062Dc78D8e0Ec1A14F7a5a09D6c75249F';
export const ESCROW_CONTRACT_ADDR = '0xBd1550ccb0388F88Ef943c0196F439e0586194b3';

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
