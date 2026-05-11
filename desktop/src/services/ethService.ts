import { ethers } from 'ethers';

export const SEPOLIA_RPC = 'https://sepolia.infura.io/v3/eaea60d233f64893b5926f90422b7b78';
export const DCLD_TOKEN_ADDR = '0xB157028062Dc78D8e0Ec1A14F7a5a09D6c75249F';
export const ESCROW_CONTRACT_ADDR = '0xBd1550ccb0388F88Ef943c0196F439e0586194b3';

export interface TokenTransfer {
    txHash: string;
    from: string;
    to: string;
    amount: string;
    blockNumber: number;
    timestamp: number;
}

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

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * Fetch the 20 most recent DCLD Transfer events involving address (sent + received).
 */
export async function getRecentTransfers(
    address: string,
    provider: ethers.JsonRpcProvider,
): Promise<TokenTransfer[]> {
    const paddedAddr = '0x' + address.toLowerCase().replace('0x', '').padStart(64, '0');
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 50000);

    const [inLogs, outLogs] = await Promise.all([
        provider.getLogs({
            address: DCLD_TOKEN_ADDR,
            fromBlock,
            toBlock: 'latest',
            topics: [TRANSFER_TOPIC, null, paddedAddr],
        }),
        provider.getLogs({
            address: DCLD_TOKEN_ADDR,
            fromBlock,
            toBlock: 'latest',
            topics: [TRANSFER_TOPIC, paddedAddr],
        }),
    ]);

    const all = [...inLogs, ...outLogs];
    all.sort((a, b) => (b.blockNumber ?? 0) - (a.blockNumber ?? 0));
    const recent = all.slice(0, 20);

    const uniqueBlocks = [...new Set(recent.map(l => l.blockNumber))];
    const blockData = await Promise.all(uniqueBlocks.map(n => provider.getBlock(n)));
    const blockTimes: Record<number, number> = {};
    blockData.forEach(b => { if (b) blockTimes[b.number] = b.timestamp; });

    return recent.map(log => ({
        txHash: log.transactionHash ?? '',
        from: '0x' + (log.topics[1] ?? '').slice(-40),
        to:   '0x' + (log.topics[2] ?? '').slice(-40),
        amount: ethers.formatUnits(BigInt(log.data), 18),
        blockNumber: log.blockNumber ?? 0,
        timestamp: blockTimes[log.blockNumber ?? 0] ?? 0,
    }));
}
