import express from "express";
import multer from "multer";
import { create } from "ipfs-http-client";
import cors from "cors";
import fs from "fs";

// 1. Setup IPFS Connection (Assumes local IPFS Desktop is running)
const ipfs = create({ url: "http://127.0.0.1:5001" });

// 2. Setup Express & Middleware
const app = express();
app.use(cors());
app.use(express.json());

// 3. Setup File Handling (Multer) - Temporarily save uploads
const upload = multer({ dest: "uploads/" });

// 4. The Upload Route
app.post("/upload", upload.single("file"), async (req: any, res: any) => {
  try {
    if (!req.file) {
      return res.status(400).send("No file uploaded.");
    }

    console.log(`📥 Receiving file: ${req.file.originalname}`);

    // Read the file from the temp folder
    const fileData = fs.readFileSync(req.file.path);

    // Upload to IPFS
    const result = await ipfs.add(fileData);
    const cid = result.path;

    console.log(`✅ File added to IPFS! CID: ${cid}`);

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    // Return the CID to the Phone
    res.send(cid);

  } catch (error) {
    console.error("❌ Upload Error:", error);
    res.status(500).send("Upload failed");
    console.log(`Is IPFS Desktop running?`);
  }
});

// 5. Start Server on 0.0.0.0 (Crucial for Mobile Access)
const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Upload Server running on http://0.0.0.0:${PORT}`);
  console.log(`Ensure IPFS Desktop is running locally! (run ipfs daemon)`);
});