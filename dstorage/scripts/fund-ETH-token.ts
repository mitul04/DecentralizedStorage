import { network } from "hardhat";

async function main() {
  const conn = await network.connect("localhost");
  const { ethers } = conn as any;
  // Your Wallet Address from the error logs
  const receiverAddress = "0x4f6a79909244731c44382f8e717A9CDA989C69FA"; 

  // Get the first account from Hardhat (It has 10,000 ETH)
  const [deployer] = await ethers.getSigners();
  
  console.log(`🏦 Sending ETH from ${deployer.address} to ${receiverAddress}...`);

  // Send 10.0 ETH
  const tx = await deployer.sendTransaction({
    to: receiverAddress,
    value: ethers.parseEther("10.0"), 
  });

  await tx.wait();

  console.log("✅ Transaction confirmed!");
  
  // Check the new balance
  const balance = await ethers.provider.getBalance(receiverAddress);
  console.log(`🎉 New ETH Balance: ${ethers.formatEther(balance)} ETH`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });