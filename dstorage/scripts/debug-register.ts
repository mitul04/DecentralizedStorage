import { network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const conn = await network.connect("localhost");
  const { ethers } = conn as any; 
  console.log("🕵️‍♂️ STARTING DIRECT DEBUG...");

  // 1. Setup Node Wallet (Account #2)
  const [deployer, user1, nodeWallet] = await ethers.getSigners();
  console.log(`👤 Acting as Node: ${nodeWallet.address}`);

  // 2. Load Addresses
  const deployPath = path.join(process.cwd(), "deployed-addresses.json");
  const addresses = JSON.parse(fs.readFileSync(deployPath, "utf8"));
  
  const token = await ethers.getContractAt("RewardToken", addresses.rewardToken, nodeWallet);
  const registry = await ethers.getContractAt("StorageNodeRegistry", addresses.storageNodeRegistry, nodeWallet);

  // 3. Check Prerequisites
  const balance = await token.balanceOf(nodeWallet.address);
  const allowance = await token.allowance(nodeWallet.address, addresses.storageNodeRegistry);
  
  console.log(`💰 Balance:   ${ethers.formatEther(balance)} STOR`);
  console.log(`🔓 Allowance: ${ethers.formatEther(allowance)} STOR`);

  // 4. Force Approve (Just to be 100% sure)
  if (allowance < ethers.parseEther("1000")) {
      console.log("⚠️ Approving now...");
      await (await token.approve(addresses.storageNodeRegistry, ethers.parseEther("10000"))).wait();
  }

  // 5. Attempt Registration (The exact call your app makes)
  // 100 GB = 107374182400 bytes
  const capacity = 107374182400n; 
  const endpoint = "http://192.168.43.118:3000";

  console.log("\n🚀 Attempting registerNode()...");
  try {
      // We use callStatic to simulate (like the app did)
      await registry.registerNode.staticCall(capacity, endpoint);
      console.log("✅ SIMULATION PASSED! The contract logic is fine.");
      
      // If sim passed, execute real tx
      const tx = await registry.registerNode(capacity, endpoint);
      console.log(`✅ TX SENT: ${tx.hash}`);
      await tx.wait();
      console.log("✅ MINED!");

  } catch (error: any) {
      console.log("\n❌ CRASH DETECTED!");
      console.log("---------------------------------------------------");
      
      // If it's a logic error, Hardhat usually decodes it here
      if (error.reason) console.log(`REASON: "${error.reason}"`);
      else if (error.message) console.log(`MESSAGE: ${error.message}`);
      
      console.log("---------------------------------------------------");
      
      // CHECK STAKE AMOUNT
      try {
          // Let's read the 'stakeAmount' variable from the contract if it exists
          // This checks if the contract demands MORE than 1000 STOR
          const requiredStake = await registry.stakeAmount();
          console.log(`ℹ️ Contract requires: ${ethers.formatEther(requiredStake)} STOR`);
      } catch (e) {
          console.log("ℹ️ Could not read 'stakeAmount' public var.");
      }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});