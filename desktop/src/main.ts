import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import express from 'express';
import cors from 'cors';
import * as fs from 'fs';
import multer from 'multer';
import { create } from 'ipfs-http-client';
import { ethers } from 'ethers'; 

// --- CONFIGURATION ---
const SERVER_PORT = 3000;
const IPFS_NODE_URL = 'http://127.0.0.1:5001'; // Default IPFS Desktop URL

// --- GLOBAL VARIABLES ---
let mainWindow: BrowserWindow | null = null;
let ipfs: any; // Will hold the IPFS client instance
let wallet: ethers.Wallet | null = null; // 👈 NEW: Global Wallet Variable

// --- 1. THE SERVER BRAIN 🧠 ---
function startServer() {
  const server = express();
  server.use(cors());
  server.use(express.json());

  // Setup Storage Folder (userData is safer than local folders)
  const uploadDir = path.join(app.getPath('userData'), 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

  // Setup Multer (File Handler)
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, file.originalname) // Keep original name
  });
  const upload = multer({ storage: storage });

  // Init IPFS
  try {
    ipfs = create({ url: IPFS_NODE_URL });
    console.log("🔹 IPFS Client Initialized");
  } catch (err) {
    console.error("❌ IPFS Init Error:", err);
    updateUI("IPFS Error - Is Desktop App Running?", "red");
  }

  // --- API: HEALTH CHECK ---
  server.get('/', (req, res) => {
    res.send('Desktop Node is Online & Ready.');
  });

  // --- API: UPLOAD (Used by Mobile App) ---
  server.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
      res.status(400).send('No file uploaded.');
      return;
    }

    console.log(`📂 Received File: ${req.file.filename}`);
    updateUI(`Processing: ${req.file.filename}...`, 'orange');

    try {
      // 1. Read file buffer
      const filePath = path.join(uploadDir, req.file.filename);
      const fileBuffer = fs.readFileSync(filePath);

      // 2. Upload to IPFS
      if (!ipfs) throw new Error("IPFS not connected");
      
      console.log("⬆️ Uploading to IPFS...");
      const result = await ipfs.add(fileBuffer);
      const cid = result.path;
      console.log(`✅ IPFS CID: ${cid}`);

      // 3. Success!
      updateUI(`Stored: ${req.file.filename}`, 'green', cid);
      res.status(200).send(cid); // Send CID back to phone

    } catch (error: any) {
      console.error("❌ Upload Failed:", error);
      updateUI("Upload Failed!", 'red');
      res.status(500).send(`Upload failed: ${error.message}`);
    }
  });

  // Start Listening
  server.listen(SERVER_PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${SERVER_PORT}`);
    updateUI('🟢 Online (Waiting for files)', 'green', 'No uploads yet');
  });
}

// Helper to send messages to the Window
function updateUI(status: string, color: string, cid?: string) {
  if (mainWindow) {
    mainWindow.webContents.send('server-status', { status, color, cid });
  }
}

// --- 2. THE ELECTRON SHELL 🐚 ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: true, // Needed to listen to IPC events
      contextIsolation: false,
    },
  });

  // Points to your src/index.html
  mainWindow.loadFile(path.join(__dirname, '../src/index.html'));
}

// --- 3. WALLET & BLOCKCHAIN LOGIC 💰 ---
const RPC_URL = "http://127.0.0.1:9545"; // Ensure this matches your Hardhat port (8545 or 9545)
const REWARD_TOKEN_ADDR = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const NODE_REGISTRY_ADDR = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

// 🟢 LOGIN EVENT
ipcMain.on('connect-wallet', async (event, privateKey) => {
  try {
    console.log("🔗 Connecting Wallet...");
    
    // 1. Setup Provider
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // 2. Setup Global Wallet
    wallet = new ethers.Wallet(privateKey, provider);
    console.log(`✅ Wallet Connected: ${wallet.address}`);

    // 3. Fetch Balance immediately
    checkBalanceAndReply();

  } catch (err: any) {
    console.error("❌ Wallet Error:", err);
  }
});

// 🔄 REFRESH EVENT
ipcMain.on('refresh-balance', async (event) => {
    if (wallet) {
        console.log("🔄 Refreshing Balance...");
        checkBalanceAndReply();
    } else {
        console.log("⚠️ No wallet connected to refresh.");
    }
});

// 📡 REGISTER NODE EVENT (Final Fix 🛠️)
ipcMain.on('register-node', async (event, data) => {
    console.log("\n--- 🏁 STARTING REGISTRATION ---");
    
    if (!wallet) {
        event.reply('registration-error', "Wallet not connected.");
        return;
    }

    try {
        const provider = wallet.provider;
        
        // 1. Setup Contracts
        const tokenAbi = ["function approve(address, uint256) returns (bool)", "function allowance(address, address) view returns (uint256)"];
        const tokenContract = new ethers.Contract(REWARD_TOKEN_ADDR, tokenAbi, wallet);
        
        // 🚨 UPDATED ABI: Added 'bool isMobile' to match your contract
        const registryAbi = ["function registerNode(string ipAddress, uint256 capacity, bool isMobile)"];
        const registryContract = new ethers.Contract(NODE_REGISTRY_ADDR, registryAbi, wallet);

        // 2. CHECK ALLOWANCE
        // Your contract requires 500 STOR, but we approve 1000 just to be safe.
        const currentAllowance = await (tokenContract as any).allowance(wallet.address, NODE_REGISTRY_ADDR);
        console.log(`🔓 Current Allowance: ${ethers.formatEther(currentAllowance)} STOR`);
        
        if (currentAllowance < ethers.parseEther("500")) {
            console.log("⚠️ Allowance low. Approving 1000 STOR...");
            const txApprove = await (tokenContract as any).approve(NODE_REGISTRY_ADDR, ethers.parseEther("1000"));
            await txApprove.wait(); 
            console.log("✅ Approved.");
        }

        // 3. REGISTER (Corrected Arguments)
        console.log("📝 Preparing Registration...");
        
        const currentNonce = await provider?.getTransactionCount(wallet.address, "latest");
        const capacityBytes = BigInt(data.capacity) * BigInt("1073741824"); // GB to Bytes

        // 🚨 THE FIX IS HERE:
        // Contract Signature: registerNode(string _ipAddress, uint256 _totalCapacity, bool _isMobile)
        const txReg = await (registryContract as any).registerNode(
            data.endpoint,   // 1. IP Address (String)
            capacityBytes,   // 2. Capacity (Uint256)
            false,           // 3. isMobile (Bool) -> False for Desktop
            { 
                nonce: currentNonce, 
                gasLimit: 500000 
            }
        );
        
        console.log(`⏳ Register Tx Sent: ${txReg.hash}`);
        await txReg.wait();
        
        console.log("✅ SUCCESS: Node Registered!");
        event.reply('registration-success', txReg.hash);

    } catch (err: any) {
        console.error("❌ Registration Failed:", err);
        event.reply('registration-error', err.message || "Unknown error");
    }
});

// 🛠️ SHARED HELPER FUNCTION
async function checkBalanceAndReply() {
    if (!wallet || !mainWindow) return;

    const provider = wallet.provider;
    if(!provider) return;

    try {
        // 1. ETH Balance
        const ethBalanceWei = await provider.getBalance(wallet.address);
        const ethBalance = ethers.formatEther(ethBalanceWei);

        // 2. STOR Balance
        const abi = ["function balanceOf(address owner) view returns (uint256)"];
        const tokenContract = new ethers.Contract(REWARD_TOKEN_ADDR, abi, provider);
        
        let storBalance = "0.00";
        try {
            // Cast to 'any' to bypass strict TS check
            const storWei = await (tokenContract as any).balanceOf(wallet.address);
            storBalance = ethers.formatEther(storWei);
        } catch (e) {
            console.log("⚠️ Could not fetch STOR balance (Contract might be wrong address)");
        }

        // 3. Send to UI
        mainWindow.webContents.send('wallet-connected', {
            address: wallet.address,
            eth: parseFloat(ethBalance).toFixed(4),
            stor: parseFloat(storBalance).toFixed(2)
        });
        
    } catch (err) {
        console.error("❌ Balance Check Failed:", err);
    }
}

app.whenReady().then(() => {
  createWindow();
  startServer(); // 🚀 Launch Server

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});