import { network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const conn = await network.connect("localhost");
  const { ethers } = conn as any; 
  // 1. Get the Deployer (Account #0)
  // This is the account that owns all the tokens initially.
  const [deployer] = await ethers.getSigners();
  
  // 2. The Recipient (Your Desktop Node - Account #2)
  const nodeAddress = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc"; 

  console.log(`🏦 Deployer (${deployer.address}) is preparing to send tokens...`);

  // 3. Load Addresses safely using fs/path 📂
  const deployPath = path.join(process.cwd(), "deployed-addresses.json");
  if (!fs.existsSync(deployPath)) {
    throw new Error("❌ Error: deployed-addresses.json not found. Did you run the deploy script?");
  }
  const addresses = JSON.parse(fs.readFileSync(deployPath, "utf8"));

  // 4. Connect to RewardToken Contract
  // We use 'deployer' here so the contract knows WHO is sending the money
  const token = await ethers.getContractAt("RewardToken", addresses.rewardToken, deployer);

  // 5. Send 1000 STOR
  const amount = ethers.parseEther("1000"); // 1000 tokens
  console.log(`💸 Sending 1000 STOR to ${nodeAddress}...`);
  
  const tx = await token.transfer(nodeAddress, amount);
  
  console.log("⏳ Transaction sent. Waiting for confirmation...");
  await tx.wait();

  console.log(`✅ Success! Sent 1000 STOR to ${nodeAddress}`);
  
  // 6. Check new balance
  const balance = await token.balanceOf(nodeAddress);
  console.log(`💰 New Node Balance: ${ethers.formatEther(balance)} STOR`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});