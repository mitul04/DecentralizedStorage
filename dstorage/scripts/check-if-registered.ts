import { network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const conn = await network.connect("localhost");
  const { ethers } = conn as any; 
  const [deployer] = await ethers.getSigners();
  
  // Your Node Address (Account #2)
  const nodeAddress = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc"; 

  // Load Addresses
  const deployPath = path.join(process.cwd(), "deployed-addresses.json");
  const addresses = JSON.parse(fs.readFileSync(deployPath, "utf8"));
  
  // Connect to Registry
  const registry = await ethers.getContractAt("StorageNodeRegistry", addresses.storageNodeRegistry);

  console.log(`🔍 Checking status for: ${nodeAddress}`);

  try {
      // Try to get node details
      const node = await registry.nodes(nodeAddress);
      
      // If capacity is greater than 0, you are registered
      if (node.isRegistered === true) {
          console.log("\n✅ YOU ARE REGISTERED!");
          console.log(`   - IP Address:     ${node.ipAddress}`);
          // 🚨 FIX: Use 'totalCapacity' instead of 'capacityBytes'
          console.log(`   - Total Capacity: ${node.totalCapacity} bytes`);
          console.log(`   - Free Capacity:  ${node.freeCapacity} bytes`);
          console.log(`   - Reputation:     ${node.reputation}`);
      } else {
          console.log("\n❌ You are NOT registered yet.");
      }
  } catch (error) {
      console.error("Error checking status:", error);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});