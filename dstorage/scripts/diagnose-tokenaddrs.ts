import { network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
    const conn = await network.connect("localhost");
    const { ethers } = conn as any; 
    // 1. Load Deployed Addresses
    const deployPath = path.join(process.cwd(), "deployed-addresses.json");
    const addresses = JSON.parse(fs.readFileSync(deployPath, "utf8"));
    
    console.log("📂 Loaded Addresses:");
    console.log(`   - RewardToken (JSON):    ${addresses.rewardToken}`);
    console.log(`   - Registry (JSON):       ${addresses.storageNodeRegistry}`);

    // 2. Query the Registry Contract
    const registry = await ethers.getContractAt("StorageNodeRegistry", addresses.storageNodeRegistry);
    
    // Ask the Registry: "Who is your Token?"
    // (Assuming you have a public variable 'rewardToken' in your contract)
    try {
        const storedTokenAddr = await registry.rewardToken();
        console.log(`\n🕵️‍♂️ Registry's Internal Token: ${storedTokenAddr}`);
        
        if (storedTokenAddr.toLowerCase() === addresses.rewardToken.toLowerCase()) {
            console.log("✅ MATCH: Registry is linked to the correct Token.");
        } else {
            console.log("❌ MISMATCH: Registry is pointing to the WRONG Token!");
            console.log("   👉 This causes the 'Internal Error' crash.");
            console.log("   👉 SOLUTION: You must redeploy.");
        }
    } catch (e) {
        console.log("⚠️ Could not read 'rewardToken' from Registry. Is the variable public?");
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});