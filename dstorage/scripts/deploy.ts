import { network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// --- HELPER: Find the real LAN IP ---
function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    // Skip internal/WSL/Docker adapters to find the real Wi-Fi/Ethernet IP
    if (name.toLowerCase().includes("wsl") || name.toLowerCase().includes("docker") || name.toLowerCase().includes("virtual") || name.toLowerCase().includes("vethernet")) {
      continue;
    }
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  console.log("⚠️  Server offline. Returning default IP");
  return "127.0.0.1"; // Fallback
}

async function main() {
  console.log("🚀 Initiating Deployment...");
  const conn = await network.connect("localhost");
  const { ethers } = conn as any;

  // 1. Deploy RewardToken
  console.log("Deploying RewardToken...");
  const token = await ethers.deployContract("RewardToken");
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`   - RewardToken: ${tokenAddress}`);

  // 2. Deploy StorageNodeRegistry (Passes Token Address)
  console.log("Deploying StorageNodeRegistry...");
  const nodeRegistry = await ethers.deployContract("StorageNodeRegistry", [tokenAddress]);
  await nodeRegistry.waitForDeployment();
  const nodeRegistryAddress = await nodeRegistry.getAddress();
  console.log(`   - StorageNodeRegistry: ${nodeRegistryAddress}`);

  // 3. Deploy FileRegistry
  console.log("Deploying FileRegistry...");
  const fileRegistry = await ethers.deployContract("FileRegistry");
  await fileRegistry.waitForDeployment();
  const fileRegistryAddress = await fileRegistry.getAddress();
  console.log(`   - FileRegistry: ${fileRegistryAddress}`);

  console.log("\n✅ Deployment Successful!");

  // --- 4. DETECT IP ADDRESS ---
  const serverIp = getLanIp();
  console.log(`💻 Detected Server IP: ${serverIp}`);

  // --- 5. SAVE FOR BACKEND (Daemon) ---
  const backendAddresses = {
    serverIp: serverIp,
    rewardToken: tokenAddress,
    storageNodeRegistry: nodeRegistryAddress,
    fileRegistry: fileRegistryAddress,
  };
  fs.writeFileSync("deployed-addresses.json", JSON.stringify(backendAddresses, null, 2));
  console.log("📂 Saved 'deployed-addresses.json' (for Daemon)");

  // --- 6. SAVE FOR FRONTEND (Mobile App) ---
  // This creates the Bridge so you don't have to copy-paste IPs manually
  const mobileConfig = {
    serverIp: serverIp,
    rpcUrl: `http://${serverIp}:9545`,
    fileRegistry: fileRegistryAddress,
    nodeRegistry: nodeRegistryAddress
  };

  // Define path: Go up two levels (../) to find 'mobile/assets'
  const mobileAssetsDir = path.join(path.dirname('.'), "../mobile/assets");

  // Create directory if it doesn't exist
  if (!fs.existsSync(mobileAssetsDir)) {
    fs.mkdirSync(mobileAssetsDir, { recursive: true });
  }

  const mobileConfigPath = path.join(mobileAssetsDir, "app_config.json");
  fs.writeFileSync(mobileConfigPath, JSON.stringify(mobileConfig, null, 2));
  
  console.log(`📱 Saved 'app_config.json' to: ${mobileConfigPath}`);
  console.log("👉 Restart your Flutter app (press 'R') to apply these changes.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});