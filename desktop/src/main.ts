    import { app, BrowserWindow, ipcMain } from 'electron';
    import * as path from 'path';
    import express from 'express';
    import cors from 'cors';
    import * as fs from 'fs';
    import multer from 'multer';
    import { create } from 'ipfs-http-client';
    import { ethers } from 'ethers';
    import axios from 'axios';
    import jwt from 'jsonwebtoken';
    import * as os from 'os';


    // Auto-detect IP helper (Optional but recommended)
    function getLocalIP() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]!) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
        return '127.0.0.1'; 
    }

    // --- CONFIGURATION ---
    const SERVER_PORT = 4000;
    const COORDINATOR_URL = 'http://127.0.0.1:3000';
    const JWT_SECRET = 'secret';
    const IPFS_NODE_URL = 'http://127.0.0.1:5001';

    // --- GLOBAL VARIABLES ---
    let mainWindow: BrowserWindow | null = null;
    let ipfs: any;
    let wallet: ethers.Wallet | ethers.HDNodeWallet | null = null;
    let heartbeatInterval: NodeJS.Timeout | null = null;
    let authToken: string | null = null; // 👈 NEW: Store the JWT

    // 🚨 UPDATED OBJECT:
    let nodeSettings = {
        isRegistered: false,
        capacity: "0", // 👈 Default to 0 safely
        endpoint: `http://${getLocalIP()}:${SERVER_PORT}` // 👈 Auto-detects e.g., http://192.168.43.118:4000
    };

    // --- 💾 DATABASE SYSTEM (NEW) ---
    // const dbPath = path.join(app.getPath('userData'), 'database.json');
    let fileHistory: any[] = [];

    // We no longer read from a file. 
    // (In the future, you can fetch this from the Coordinator's DB)
    function loadDatabase() {
        fileHistory = [];
    }

    // We no longer write to a file, we just update the UI
    function saveDatabase() {
        if (mainWindow) {
            mainWindow.webContents.send('update-history', fileHistory);
            updateDashboardStats();
        }
    }

    function updateDashboardStats() {
        if (!mainWindow) return;
        
        const totalFiles = fileHistory.length;
        // Calculate total size in MB
        const totalSizeBytes = fileHistory.reduce((acc, file) => acc + (file.sizeBytes || 0), 0);
        const totalSizeMB = (totalSizeBytes / (1024 * 1024)).toFixed(2);

        mainWindow.webContents.send('update-dashboard', {
            files: totalFiles,
            storage: totalSizeMB
        });
    }

    // --- 1. THE SERVER BRAIN 🧠 ---
    function startServer() {
    const server = express();
    server.use(cors());
    server.use(express.json());

    // Setup Storage Folder
    const uploadDir = path.join(app.getPath('userData'), 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

    // Setup Multer
    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadDir),
        filename: (req, file, cb) => cb(null, file.originalname)
    });
    const upload = multer({ storage: storage });

    // Init IPFS
    try {
        ipfs = create({ url: IPFS_NODE_URL });
        console.log("🔹 IPFS Client Initialized");
        //console.log("🗑️ Database file located at:", path.join(app.getPath('userData'), 'database.json'));
    } catch (err) {
        console.error("❌ IPFS Init Error:", err);
        updateUI("IPFS Error - Is Desktop App Running?", "red");
    }

    // --- API: HEALTH CHECK ---
    server.get('/', (req, res) => {
        res.send('Desktop Node is Online & Ready.');
    });

    // --- API: UPLOAD ---
    // Note: authenticateUpload middleware removed for testing ease as per previous context
    server.post('/upload', upload.single('file'), async (req: any, res: any) => {
        if (!req.file) {
        console.log("⚠️ Upload request received, but no file found in 'file' field.");
        res.status(400).send('No file uploaded. Ensure form-data key is "file".');
        return;
        }

        console.log(`📂 Received File: ${req.file.originalname}`); 
        updateUI(`Processing ${req.file.originalname}...`, 'orange');

        try {
        const filePath = path.join(uploadDir, req.file.filename);
        const fileBuffer = fs.readFileSync(filePath);

        if (!ipfs) throw new Error("IPFS not connected");
        
        console.log("⬆️ Uploading to IPFS...");
        const result = await ipfs.add(fileBuffer);
        const cid = result.path;
        console.log(`✅ IPFS CID: ${cid}`);

        // --- SAVE TO DATABASE (NEW) ---
        const newFile = {
            name: req.file.originalname,
            size: (req.file.size / (1024 * 1024)).toFixed(2) + ' MB',
            sizeBytes: req.file.size,
            date: new Date().toLocaleDateString(),
            cid: cid,
            status: 'Active' // Default status
        };
        fileHistory.unshift(newFile); // Add to top of list
        saveDatabase();
        // -----------------------------

        updateUI(`Stored: ${req.file.filename}`, 'green', cid);
        res.status(200).send(cid);

        } catch (error: any) {
        console.error("❌ Upload Failed:", error);
        updateUI("Upload Failed!", 'red');
        res.status(500).send(`Upload failed: ${error.message}`);
        }
    });

    // --- API: RETRIEVE FILE 🔍 ---
    server.get('/retrieve/:cid', async (req: any, res: any) => {
        const cid = req.params.cid;
        
        // 🚨 NEW: Log the IP address of the person requesting the file!
        const requesterIP = req.ip || req.socket.remoteAddress;
        console.log(`🚨 DOWNLOAD REQUEST | CID: ${cid.substring(0, 8)}... | FROM IP: ${requesterIP}`);

        try {
        if (!ipfs) throw new Error("IPFS not connected");

        const stream = ipfs.cat(cid);
        for await (const chunk of stream) {
            res.write(chunk);
        }
        
        res.end();
        console.log(`✅ Served CID: ${cid}`);

        } catch (err: any) {
        console.error("❌ Retrieval Failed:", err);
        res.status(500).send("Error retrieving file from IPFS Node");
        }
    });

    server.listen(SERVER_PORT, '0.0.0.0', () => {
        console.log(`✅ Node Server running on port ${SERVER_PORT}`);
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
        width: 1000,
        height: 700,
        webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        },
    });

    mainWindow.loadFile(path.join(__dirname, '../src/index.html'));

    // When window loads, send the saved data!
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow?.webContents.send('update-history', fileHistory);
        updateDashboardStats();
    });
    }

    // 🔐 WEB3 AUTHENTICATION FLOW
    async function authenticateWithCoordinator(isRegistering = false): Promise<boolean> {
        if (!wallet) return false;

        try {
            console.log(`🔐 Step 1: Requesting nonce (Mode: ${isRegistering ? 'REGISTER' : 'LOGIN'})...`);
            
            // 🚨 FIX 1: Sending data in the Body of a GET request using Axios 'data' property
            const nonceRes = await axios.post(`${COORDINATOR_URL}/auth/nonce`, {
                wallet_address: wallet.address
            });
            
            const nonce = nonceRes.data.nonce;

            console.log("✍️ Step 2: Signing the nonce...");
            const signature = await wallet.signMessage(nonce);

            console.log("🔑 Step 3: Verifying signature & getting token...");

            // 🚨 FIX: Translate Node.js OS names into standard DB uppercase names
            const rawOS = os.platform();
            let dbOsType = 'WINDOWS'; // Default
            if (rawOS === 'win32') dbOsType = 'Windows';
            else if (rawOS === 'darwin') dbOsType = 'MacOS';
            else if (rawOS === 'linux') dbOsType = 'Linux';
            else dbOsType = rawOS.toUpperCase();
            
            // 🚨 FIX 2: Added all the newly required fields from the authController
            const payload = {
                wallet_address: wallet.address,
                nonce: nonce,          // Teammate's backend now requires we send this back
                signature: signature,
                mode: isRegistering ? 'REGISTER' : 'LOGIN',
                role: 'STORAGE_PEER',
                os_type: 'LINUX', //os.platform(), // e.g., 'win32', 'darwin', 'linux'
                declared_capacity: parseInt(nodeSettings.capacity) || 100 // Must be > 0 for registration
            };

            const verifyRes = await axios.post(`${COORDINATOR_URL}/auth/verify`, payload);

            authToken = verifyRes.data.token;
            console.log("✅ Step 4: Authentication Success! JWT secured.");
            
            return true;

        } catch (error: any) {
            const errorMsg = error.response?.data?.error || error.message;
            console.error("❌ Authentication Failed:", errorMsg);

            // 🚨 FIX 3: Smart Retry
            // If we tried to LOGIN but aren't in the PostgreSQL database yet, 
            // we catch the error and retry exactly once as a REGISTER request!
            if (!isRegistering && errorMsg === 'Storage peer not registered') {
                console.log("ℹ️ Node not in Coordinator DB yet. Attempting to Register...");
                return await authenticateWithCoordinator(true); 
            }

            return false;
        }
    }

    // --- 3. WALLET & BLOCKCHAIN LOGIC 💰 ---
    const RPC_URL = "http://127.0.0.1:9545";
    const REWARD_TOKEN_ADDR = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    const NODE_REGISTRY_ADDR = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

    // 🛠️ SHARED HELPER FUNCTION
    async function checkBalanceAndReply() {
        if (!wallet || !mainWindow) return;

        const provider = wallet.provider;
        if(!provider) return;

        try {
            const ethBalanceWei = await provider.getBalance(wallet.address);
            const ethBalance = ethers.formatEther(ethBalanceWei);

            const tokenAbi = ["function balanceOf(address owner) view returns (uint256)"];
            const tokenContract = new ethers.Contract(REWARD_TOKEN_ADDR, tokenAbi, provider);
            
            let storBalance = "0.00";
            try {
                const storWei = await (tokenContract as any).balanceOf(wallet.address);
                storBalance = ethers.formatEther(storWei);
            } catch (e) {
                console.log("⚠️ Could not fetch STOR balance");
            }

            // 🚨 NEW: Ask the Blockchain if this specific wallet is registered
            let isNodeRegistered = false;
            try {
                // Using the struct signature from your Flutter implementation
                const registryAbi = ["function nodes(address) view returns (string, uint256, uint256, uint256, uint256, bool, bool)"];
                const registryContract = new ethers.Contract(NODE_REGISTRY_ADDR, registryAbi, provider);
                
                const nodeProfile = await (registryContract as any).nodes(wallet.address);
                isNodeRegistered = nodeProfile[6]; // The 7th item in the struct is the boolean 'isRegistered'
                console.log(`📡 Registration Check: ${isNodeRegistered ? 'Already Registered' : 'Not Registered'}`);
            } catch (e) {
                console.log("⚠️ Could not fetch node profile from blockchain.");
            }

            mainWindow.webContents.send('wallet-connected', {
                address: wallet.address,
                eth: parseFloat(ethBalance).toFixed(4),
                stor: parseFloat(storBalance).toFixed(2),
                isRegistered: isNodeRegistered // 👈 Pass the status to the frontend
            });
            
        } catch (err) {
            console.error("❌ Balance Check Failed:", err);
        }
    }

    // 💓 THE HEARTBEAT FUNCTION
    function startHeartbeat(walletAddress: string) {
        if (heartbeatInterval) clearInterval(heartbeatInterval);

        console.log("💓 Starting Heartbeat Service...");
        
        // Run immediately
        sendHeartbeat(walletAddress);

        // Then run every 30 seconds
        heartbeatInterval = setInterval(() => {
            sendHeartbeat(walletAddress);
        }, 30000); 
    }

    async function sendHeartbeat(address: string) {
        if (!authToken) {
            console.log("⚠️ Skipping heartbeat: Not authenticated yet.");
            return;
        }

        try {
            const localIP = getLocalIP(); 
            const payload = {
                walletAddress: address,
                ipAddress: `http://${localIP}:${SERVER_PORT}`, 
                freeCapacity: nodeSettings.capacity + "GB", // 👈 Dynamically grabbing this from our settings!
                timestamp: Date.now()
            };

            // 🚨 NEW: Attach the JWT Token to the request headers
            await axios.post(`${COORDINATOR_URL}/api/nodes/heartbeat`, payload, {
                headers: {
                    Authorization: `Bearer ${authToken}`
                }
            });
            
            console.log(`💓 Secure Ping sent. IP: http://${localIP}:${SERVER_PORT}`);
            
        } catch (error: any) {
            console.log("⚠️ Heartbeat failed: " + (error.response?.data?.error || "Coordinator offline"));
        }
    }

    // 🟢 LOGIN EVENT
    ipcMain.on('connect-wallet', async (event, secretInput) => {
    try {
        console.log("🔗 Connecting Wallet...");
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        
        const cleanInput = secretInput.trim(); 
        if (cleanInput.includes(" ")) {
            wallet = ethers.Wallet.fromPhrase(cleanInput, provider);
        } else {
            wallet = new ethers.Wallet(cleanInput, provider);
        }

        console.log(`✅ Wallet Connected: ${wallet.address}`);

        // 🚨 NEW: Authenticate with the backend immediately
        const isAuthenticated = await authenticateWithCoordinator();
        
        if (!isAuthenticated) {
            event.reply('registration-error', "Wallet connected, but backend authentication failed. Check Coordinator logs.");
            return; 
        }

        if (wallet) startHeartbeat(wallet.address);
        checkBalanceAndReply();

    } catch (err: any) {
        console.error("❌ Wallet Connection Failed:", err);
        event.reply('registration-error', "Invalid Phrase or Key.");
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

    // 📡 REGISTER NODE EVENT
    ipcMain.on('register-node', async (event, data) => {
        console.log("\n--- 🏁 STARTING REGISTRATION ---");
        
        if (!wallet) {
            event.reply('registration-error', "Wallet not connected.");
            return;
        }

        try {
            const provider = wallet.provider;
            
            const tokenAbi = ["function approve(address, uint256) returns (bool)", "function allowance(address, address) view returns (uint256)"];
            const tokenContract = new ethers.Contract(REWARD_TOKEN_ADDR, tokenAbi, wallet);
            
            const registryAbi = ["function registerNode(string ipAddress, uint256 capacity, bool isMobile)"];
            const registryContract = new ethers.Contract(NODE_REGISTRY_ADDR, registryAbi, wallet);

            const currentAllowance = await (tokenContract as any).allowance(wallet.address, NODE_REGISTRY_ADDR);
            console.log(`🔓 Current Allowance: ${ethers.formatEther(currentAllowance)} STOR`);
            
            if (currentAllowance < ethers.parseEther("500")) {
                console.log("⚠️ Allowance low. Approving 1000 STOR...");
                const txApprove = await (tokenContract as any).approve(NODE_REGISTRY_ADDR, ethers.parseEther("1000"));
                await txApprove.wait(); 
                console.log("✅ Approved.");
            }

            console.log("📝 Preparing Registration...");
            
            const currentNonce = await provider?.getTransactionCount(wallet.address, "latest");
            const capacityBytes = BigInt(data.capacity) * BigInt("1073741824"); 

            const txReg = await (registryContract as any).registerNode(
                data.endpoint,   
                capacityBytes,   
                false,           
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
            const errorMsg = err.message || "";
            
            // 🚨 NEW: Gracefully catch the contract revert error
            if (errorMsg.toLowerCase().includes("already registered") || errorMsg.toLowerCase().includes("registered")) {
                console.log("ℹ️ Node was already registered. Updating UI.");
                event.reply('registration-success', "Already Registered");
            } else {
                event.reply('registration-error', errorMsg);
            }
        }
    });

    // 🔄 UPDATE IP EVENT
    ipcMain.on('update-ip', async (event, data) => {
        console.log("\n--- 🔄 STARTING IP UPDATE ---");
        
        if (!wallet) {
            event.reply('registration-error', "Wallet not connected.");
            return;
        }

        try {
            const provider = wallet.provider;
            
            // Use the exact function signature from your contract
            const registryAbi = ["function updateIpAddress(string _newIp)"];
            const registryContract = new ethers.Contract(NODE_REGISTRY_ADDR, registryAbi, wallet);

            console.log(`📝 Updating IP to: ${data.endpoint}...`);
            
            const txUpdate = await (registryContract as any).updateIpAddress(data.endpoint);
            
            console.log(`⏳ Update Tx Sent: ${txUpdate.hash}`);
            await txUpdate.wait();
            
            console.log("✅ SUCCESS: Node IP Updated!");
            event.reply('update-success', txUpdate.hash);

        } catch (err: any) {
            console.error("❌ IP Update Failed:", err);
            event.reply('registration-error', err.message || "Unknown error during IP update");
        }
    });

    // 🛑 DEREGISTER NODE EVENT
    ipcMain.on('deregister-node', async (event) => {
        console.log("\n--- 🏁 STARTING DEREGISTRATION ---");
        
        if (!wallet) {
            event.reply('registration-error', "Wallet not connected.");
            return;
        }

        try {
            const provider = wallet.provider;
            
            const registryAbi = ["function deregisterNode()"];
            const registryContract = new ethers.Contract(NODE_REGISTRY_ADDR, registryAbi, wallet);

            console.log("📝 Sending Deregister Transaction...");
            const txDereg = await (registryContract as any).deregisterNode();
            
            console.log(`⏳ Deregister Tx Sent: ${txDereg.hash}`);
            await txDereg.wait();
            
            console.log("✅ SUCCESS: Node Deregistered and stake refunded!");
            event.reply('deregister-success', txDereg.hash);

        } catch (err: any) {
            console.error("❌ Deregistration Failed:", err);
            event.reply('registration-error', err.message || "Unknown error during deregistration");
        }
    });

    app.whenReady().then(() => {
    loadDatabase(); // 👈 LOAD DATA ON START
    createWindow();
    startServer();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    });

    app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
    });