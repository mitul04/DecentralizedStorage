import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import '../services/blockchain_service.dart';

class UploadScreen extends StatefulWidget {
  const UploadScreen({super.key});

  @override
  State<UploadScreen> createState() => _UploadScreenState();
}

class _UploadScreenState extends State<UploadScreen> {
  String? _fileName;
  PlatformFile? _pickedFile; // Store the actual file data
  bool _isUploading = false;

  // This function triggers the native file picker
  Future<void> _pickFile() async {
    // Pick file (allow any extension)
    FilePickerResult? result = await FilePicker.platform.pickFiles();

    if (result != null) {
      setState(() {
        _pickedFile = result.files.first;
        _fileName = result.files.single.name;
      });
    }
  }

  // Placeholder for the actual upload logic
  Future<void> _uploadFile() async {
    if (_pickedFile == null) return;

    setState(() => _isUploading = true);

    try {
      final service = BlockchainService();
      await service.init(); // Initialize connection

      // 1. Upload to Laptop
      String? cid = await service.uploadFileToStorage(
        _pickedFile!.path!, 
        _pickedFile!.name
      );

      if (cid != null) {
        // 2. Save to Blockchain
        await service.storeFileOnChain(
          _pickedFile!.name, 
          cid, 
          _pickedFile!.size
        );

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text("✅ Success! Hash: $cid")),
          );
        }
      } else {
        throw Exception("Upload to server failed");
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("❌ Error: $e")),
        );
      }
    }
    
    setState(() {
      _isUploading = false;
      _fileName = null;
      _pickedFile = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text("Upload File", 
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
          const Text("Securely store your data on Decloud", 
              style: TextStyle(color: Colors.grey)),
          const SizedBox(height: 30),

          // 1. The File Picker Area (Now using standard Border)
          GestureDetector(
            onTap: _pickFile,
            child: Container(
              width: double.infinity,
              height: 200,
              decoration: BoxDecoration(
                color: const Color(0xFF6C63FF).withOpacity(0.05),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: const Color(0xFF6C63FF), // Purple Border
                  width: 2,
                ),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    _fileName == null ? Icons.cloud_upload_outlined : Icons.check_circle,
                    size: 60,
                    color: const Color(0xFF6C63FF),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    _fileName ?? "Tap to select a file",
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: _fileName == null ? Colors.grey[600] : Colors.black87,
                    ),
                  ),
                  if (_pickedFile != null)
                    Text(
                      "${(_pickedFile!.size / 1024).toStringAsFixed(1)} KB",
                      style: const TextStyle(color: Colors.grey, fontSize: 12),
                    ),
                ],
              ),
            ),
          ),

          const Spacer(),

          // 2. The Upload Button
          SizedBox(
            width: double.infinity,
            height: 55,
            child: ElevatedButton(
              onPressed: (_fileName != null && !_isUploading) ? _uploadFile : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF6C63FF),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(15),
                ),
                elevation: 0,
              ),
              child: _isUploading
                  ? const SizedBox(
                      height: 20, 
                      width: 20, 
                      child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)
                    )
                  : const Text("Upload to Blockchain", 
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            ),
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }
}