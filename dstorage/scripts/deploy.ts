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

  // 2. Deploy StorageNodeRegistry
  console.log("Deploying StorageNodeRegistry...");
  // 🚨 NEW: We use Hardhat Account #1 (0x7099...) as the Coordinator Boss for local testing
  const coordinatorSigner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; 
  const nodeRegistry = await ethers.deployContract("StorageNodeRegistry", [tokenAddress, coordinatorSigner]);
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

  // SAVE FOR BACKEND (Daemon / Hardhat Scripts)
  const backendAddresses = {
    serverIp: serverIp,
    rewardToken: tokenAddress,
    storageNodeRegistry: nodeRegistryAddress,
    fileRegistry: fileRegistryAddress,
  };
  fs.writeFileSync("deployed-addresses.json", JSON.stringify(backendAddresses, null, 2));
  console.log("📂 Saved 'deployed-addresses.json' (for Hardhat scripts)");

  // --- SAVE FOR FRONTEND (Mobile App) ---
  const mobileConfig = {
    serverIp: serverIp,
    rpcUrl: `http://${serverIp}:9545`, // Note: Default Hardhat RPC is usually 8545, double check yours!
    fileRegistry: fileRegistryAddress,
    nodeRegistry: nodeRegistryAddress,
    rewardToken: tokenAddress
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

  // 🚨 NEW: AUTOMATICALLY EXPORT ABIS TO FLUTTER 🚨
  console.log("📄 Exporting Smart Contract ABIs to Mobile App...");
  
  // 1. Read the compiled artifacts containing the abi array (using fs instead of require for TypeScript compatibility)
  const tokenArtifact = JSON.parse(fs.readFileSync("./artifacts/contracts/RewardToken.sol/RewardToken.json", "utf8"));
  const nodeArtifact = JSON.parse(fs.readFileSync("./artifacts/contracts/StorageNodeRegistry.sol/StorageNodeRegistry.json", "utf8"));
  const fileArtifact = JSON.parse(fs.readFileSync("./artifacts/contracts/FileRegistry.sol/FileRegistry.json", "utf8"));

  // 2. Write ONLY the 'abi' array directly into the Flutter assets folder
  fs.writeFileSync(path.join(mobileAssetsDir, "reward_token_abi.json"), JSON.stringify(tokenArtifact.abi, null, 2));
  fs.writeFileSync(path.join(mobileAssetsDir, "node_registry_abi.json"), JSON.stringify(nodeArtifact.abi, null, 2));
  fs.writeFileSync(path.join(mobileAssetsDir, "file_registry_abi.json"), JSON.stringify(fileArtifact.abi, null, 2));
  
  console.log("✅ ABIs successfully synchronized with Flutter!");
  console.log("👉 Restart your Flutter app (press 'R') to apply these changes.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});