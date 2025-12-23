import { network } from "hardhat";
import * as fs from "fs";
import path from "path";

async function main() {
  console.log("👻 Starting Network Simulation: Populating Ghost Nodes...");

  // 1. Connect and Load Signers
  const conn = await network.connect("localhost");
  const { ethers } = conn as any;
  const allSigners = await ethers.getSigners();
  
  // --- CHANGE 1: Explicitly separate the Mobile User (Account 1) ---
  // 0 = Boss (Deployer)
  // 1 = Mobile User (You)
  // 2+ = Ghosts
  const [deployer, mobileUser, ...ghosts] = allSigners;

  // 2. Load Addresses
  const deployPath = path.join(process.cwd(), "deployed-addresses.json");
  if (!fs.existsSync(deployPath)) throw new Error("❌ Error: deployed-addresses.json not found.");
  const addresses = JSON.parse(fs.readFileSync(deployPath, "utf8"));

  // 3. Connect to Contracts (As the Deployer first)
  const token = await ethers.getContractAt("RewardToken", addresses.rewardToken, deployer);
  const registry = await ethers.getContractAt("StorageNodeRegistry", addresses.storageNodeRegistry, deployer);

  // --- CHANGE 2: Fund the Mobile User ---
  const starterBalance = ethers.parseEther("1250.0"); // 1,250 DEC
  console.log(`🎁 Airdropping ${ethers.formatEther(starterBalance)} DEC to Mobile User (${mobileUser.address.slice(0,6)})...`);
  
  try {
      const tx = await token.transfer(mobileUser.address, starterBalance);
      await tx.wait();
      console.log("   ✅ Transferred!");
  } catch (e) {
      console.log(`   ⚠️ Transfer failed (maybe already done): ${e}`);
  }

  const stakeAmount = await registry.stakeAmount(); // 500 STOR

  console.log(`\n💰 Distributing Stimulus Packages (Funding ${ghosts.length} nodes)...`);

  console.log(`\n👑 REGISTERING "THE BOSS" (Your Real Laptop)...`);

  // --- STEP 4: REGISTER THE REAL LAPTOP (Node #0) ---

  const realIp = `http://${addresses.serverIp}:3000`;
  const realCapacity = BigInt(500) * BigInt(1024 ** 3); // 500 GB

  try {
    const profile = await registry.nodes(deployer.address);
    if (profile.isRegistered) {
      console.log(`   ✅ Boss already registered at ${profile.ipAddress}`);
    } else {
      // Deployer owns all tokens, so no need to transfer. Just Approve.
      console.log(`   📝 Approving Stake...`);
      const approveTx = await token.approve(addresses.storageNodeRegistry, stakeAmount);
      await approveTx.wait();

      console.log(`   📝 Registering Real IP: ${realIp}...`);
      const regTx = await registry.registerNode(realIp, realCapacity, false); // false = PC
      await regTx.wait();
      console.log(`   🚀 SUCCESS! Your laptop is Node #0.`);
    }
  } catch (e) {
    console.log(`   ❌ Failed to register Boss: ${e}`);
  }

  console.log(`\n👻 RELEASING THE GHOSTS (Populating Accounts #2-#${ghosts.length + 1})...`);

  // 4. The "Ghost" Loop
  for (let i = 0; i < ghosts.length; i++) {
    const ghost = ghosts[i];
    const ghostIp = `http://192.168.0.${101 + i}:3000`; // Fake IP
    const isMobile = i % 3 === 0; // Every 3rd node is mobile
    
    // Randomize Capacity between 100GB and 1TB
    const randomGB = Math.floor(Math.random() * (1000 - 100 + 1) + 100);
    const capacityBytes = BigInt(randomGB) * BigInt(1024 ** 3);

    process.stdout.write(`   [Node #${i + 2}] Processing ${ghost.address.slice(0, 6)}... `);

    try {
      // A. Check if already registered
      const profile = await registry.nodes(ghost.address);
      if (profile.isRegistered) {
        console.log(`Skipping (Already registered)`);
        continue;
      }

      // B. FUND THE GHOST (Transfer 500 STOR from Deployer -> Ghost)
      const ghostBalance = await token.balanceOf(ghost.address);
      if (ghostBalance < stakeAmount) {
          const fundTx = await token.transfer(ghost.address, stakeAmount);
          await fundTx.wait();
      }

      // C. SWITCH IDENTITY (Connect contract as the Ghost)
      const tokenAsGhost = token.connect(ghost);
      const registryAsGhost = registry.connect(ghost);

      // D. APPROVE
      const approveTx = await tokenAsGhost.approve(addresses.storageNodeRegistry, stakeAmount);
      await approveTx.wait();

      // E. REGISTER
      const regTx = await registryAsGhost.registerNode(ghostIp, capacityBytes, isMobile);
      await regTx.wait();
      
      console.log(`✅ ${randomGB}GB`);

    } catch (err) {
      console.error(`❌ Failed: ${err}`);
    }
  }

  console.log("\n🎉 Simulation Complete! Run 'administer.ts' to see the network.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});