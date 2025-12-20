import { network } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  console.log("🤖 Storage Node Daemon starting...");

  // 1. Connect to Blockchain
  const conn = await network.connect("localhost");
  const { ethers } = conn as any;
  const [signer] = await ethers.getSigners();
  
  // 2. Load JSON
  const deploymentPath = path.join(process.cwd(), "deployed-addresses.json");
  if (!fs.existsSync(deploymentPath)) {
    console.error("❌ Error: deployed-addresses.json not found.");
    process.exit(1);
  }
  const addresses = JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));

  //3. Determine My Node URL
  const myIp = addresses.serverIp;
  console.log(`💻 Detected Server IP: ${myIp}`);
  const myNodeUrl = `http://${myIp}:3000`; 

  // 4. Connect to Contracts
  const storageRegistry = await ethers.getContractAt("StorageNodeRegistry", addresses.storageNodeRegistry, signer);
  const rewardToken = await ethers.getContractAt("RewardToken", addresses.rewardToken, signer);
  const fileRegistry = await ethers.getContractAt("FileRegistry", addresses.fileRegistry, signer);

  console.log(`👤 Operating as Node: ${signer.address}`);

  // 5. Connect to IPFS 
  console.log("🔌 Connecting to Local IPFS Node...");
  const { create } = await import("ipfs-http-client");
  const ipfs = create({ url: "http://127.0.0.1:5001" });

  // ---------------------------------------------------------
  // 6. THE BRAIN: Staking & Registration
  // ---------------------------------------------------------
  const stakeAmount = await storageRegistry.stakeAmount();
  const myProfile = await storageRegistry.nodes(signer.address);

  if (myProfile.isRegistered) {
    console.log(`🔍 Blockchain IP: ${myProfile.ipAddress}`);
    console.log(`💻 Local IP:      ${myNodeUrl}`);

    if (myProfile.ipAddress !== myNodeUrl) {
        console.log(`⚠️ IP Mismatch! Blockchain has old IP. Updating now...`);
        const tx = await storageRegistry.updateIpAddress(myNodeUrl);
        await tx.wait();
        console.log("✅ IP Updated on Blockchain!");
    } else {
        console.log("✅ IPs match. No gas spent.");
    }

  } else {
    // First time registration
    console.log(`💰 Staking required: ${ethers.formatEther(stakeAmount)} STOR`);
    console.log(`📝 Registering Node at ${myNodeUrl}...`);
    
    // Approve
    const approveTx = await rewardToken.approve(addresses.storageNodeRegistry, stakeAmount);
    await approveTx.wait();
    
    // Register
    const capacity250GB = 250 * 1024 * 1024 * 1024; 
    const registerTx = await storageRegistry.registerNode(
      myNodeUrl, 
      capacity250GB,             
      false 
    );
    await registerTx.wait();
    console.log("✅ Registration Successful!");
  }

  // 7. THE PULSE: Heartbeat Loop
  console.log("❤️ Starting Heartbeat Service (1 Hour Interval)...");
  setInterval(async () => {
    try {
      // console.log("   ... Pinging Registry"); 
      const tx = await storageRegistry.ping();
      await tx.wait();
    } catch (e) { console.error("   ❌ Heartbeat Failed:", e); }
  }, 60 * 60 * 1000); 

  // 8. THE MUSCLE: Event Listener
  console.log(`👀 Watching FileRegistry at: ${addresses.fileRegistry}`);
  
  fileRegistry.on("FileRegistered", async (cid, fileName, owner) => {
      console.log("---------------------------------------------------");
      console.log(`🔔 EVENT DETECTED: New File Registered!`);
      console.log(`   📂 Name: ${fileName}`);
      console.log(`   📝 CID:  ${cid}`);

      console.log("   ⬇️  Pinning file from IPFS network...");
      try {
          await ipfs.pin.add(cid);
          console.log(`   ✅ File successfully PINNED to local storage!`);
      } catch (err) {
          console.error("   ❌ Failed to pin file.");
      }
  });

  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});