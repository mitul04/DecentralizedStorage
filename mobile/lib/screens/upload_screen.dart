import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import '../services/blockchain_service.dart';

class UploadScreen extends StatefulWidget {
  const UploadScreen({super.key});

  @override
  State<UploadScreen> createState() => _UploadScreenState();
}

class _UploadScreenState extends State<UploadScreen> {
  final BlockchainService _service = BlockchainService();
  
  // File State
  String? _fileName;
  PlatformFile? _pickedFile; 
  bool _isUploading = false;
  
  // Redundancy State
  double _replicationValue = 1.0; 

  // Node Selection State
  List<Map<String, dynamic>> _allNodes = [];
  
  // We now store a LIST of selected nodes. 
  // Index 0 is always the Primary (Uploader).
  List<Map<String, dynamic>?> _selectedNodes = [null]; 
  
  bool _isLoadingNodes = true;

  @override
  void initState() {
    super.initState();
    _loadNodes();
  }

  // 1. Fetch available nodes
  Future<void> _loadNodes() async {
    await _service.init();
    final nodes = await _service.getAvailableNodes();
    
    if (mounted) {
      setState(() {
        _allNodes = nodes;
        _isLoadingNodes = false;
      });
    }
  }

  // 2. Handle Slider Changes
  void _updateSlots(int count) {
    setState(() {
      _replicationValue = count.toDouble();
      
      // Resize the list while keeping existing selections
      if (count > _selectedNodes.length) {
        // Add null slots
        int diff = count - _selectedNodes.length;
        _selectedNodes.addAll(List.filled(diff, null));
      } else {
        // Trim the list
        _selectedNodes = _selectedNodes.sublist(0, count);
      }
    });
  }

  Future<void> _pickFile() async {
    FilePickerResult? result = await FilePicker.platform.pickFiles();
    if (result != null) {
      setState(() {
        _pickedFile = result.files.first;
        _fileName = result.files.single.name;
      });
    }
  }

  Future<void> _uploadFile() async {
    // Validation: Check if all slots are filled
    if (_pickedFile == null || _selectedNodes.contains(null)) {
       ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("⚠️ Please select a node for every slot.")),
        );
      return;
    }

    // Validation: Check for duplicates (Optional, but good for demo)
    final addresses = _selectedNodes.map((n) => n!['address']).toSet();
    if (addresses.length != _selectedNodes.length) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("⚠️ You cannot select the same node twice!")),
        );
        return;
    }

    setState(() => _isUploading = true);

    try {
      // A. Upload to PRIMARY Node (Index 0) - This MUST be the real one
      final primaryNode = _selectedNodes[0]!;
      final targetIp = primaryNode['ip'];
      final targetUrl = "$targetIp/upload";
      
      print("🚀 Uploading to Primary: $targetUrl");

      String? cid = await _service.uploadFileToSpecificNode(
        _pickedFile!.path!, 
        _pickedFile!.name,
        targetUrl
      );

      if (cid != null) {
        // B. Prepare List of ALL Hosts
        // We cast the nullable list to a non-nullable list of addresses
        List<String> allHostAddresses = _selectedNodes.map((n) => n!['address'].toString()).toList();

        // C. Save to Blockchain
        await _service.storeFileOnChain(
          _pickedFile!.name, 
          cid, 
          _pickedFile!.size,
          _replicationValue.toInt(),
          allHostAddresses // Pass the list of user-selected addresses
        );

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("✅ File Distributed Successfully!"), backgroundColor: Colors.green),
          );
          // Reset
          setState(() {
            _pickedFile = null;
            _fileName = null;
          });
        }
      } else {
        throw Exception("Primary Node rejected connection. Is it online?");
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("❌ Error: $e"), backgroundColor: Colors.redAccent),
        );
      }
    }
    
    setState(() => _isUploading = false);
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text("Upload File", style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
            const Text("Manually configure your network topology", style: TextStyle(color: Colors.grey)),
            const SizedBox(height: 20),

            // --- 1. REDUNDANCY SLIDER ---
            const Text("1. Redundancy Level", style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF6C63FF))),
            Row(
              children: [
                const Icon(Icons.copy_all, color: Colors.grey),
                Expanded(
                  child: Slider(
                    value: _replicationValue,
                    min: 1,
                    max: 5,
                    divisions: 4,
                    activeColor: const Color(0xFF6C63FF),
                    label: "${_replicationValue.toInt()} Nodes",
                    onChanged: (value) => _updateSlots(value.toInt()),
                  ),
                ),
                Text("${_replicationValue.toInt()} Nodes", style: const TextStyle(fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 20),

            // --- 2. DYNAMIC NODE SELECTORS ---
            const Text("2. Select Storage Nodes", style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF6C63FF))),
            const SizedBox(height: 10),
            
            if (_isLoadingNodes) 
              const LinearProgressIndicator(color: Color(0xFF6C63FF))
            else 
              ...List.generate(_selectedNodes.length, (index) {
                return Padding(
                  padding: const EdgeInsets.only(bottom: 15.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Label
                      Text(
                        index == 0 ? "Node 1 (Primary Uploader)" : "Node ${index + 1} (Replica)", 
                        style: TextStyle(
                          fontSize: 12, 
                          fontWeight: FontWeight.bold,
                          color: index == 0 ? Colors.black87 : Colors.grey
                        )
                      ),
                      const SizedBox(height: 5),
                      
                      // Dropdown
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        decoration: BoxDecoration(
                          border: Border.all(color: Colors.grey.shade300),
                          borderRadius: BorderRadius.circular(12),
                          color: index == 0 ? const Color(0xFFF5F5FF) : Colors.white, // Highlight Primary
                        ),
                        child: DropdownButtonHideUnderline(
                          child: DropdownButton<Map<String, dynamic>>(
                            value: _selectedNodes[index],
                            isExpanded: true,
                            hint: const Text("Select Node"),
                            items: _allNodes.map((node) {
                              return DropdownMenuItem<Map<String, dynamic>>(
                                value: node,
                                child: Text(
                                  "Node ${node['address'].substring(0,6)}... (Rep: ${node['reputation']})",
                                  overflow: TextOverflow.ellipsis,
                                ),
                              );
                            }).toList(),
                            onChanged: (value) {
                              setState(() {
                                _selectedNodes[index] = value;
                              });
                            },
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              }),

            const SizedBox(height: 20),

            // --- 3. FILE PICKER ---
            GestureDetector(
              onTap: _pickFile,
              child: Container(
                width: double.infinity,
                height: 120,
                decoration: BoxDecoration(
                  color: const Color(0xFF6C63FF).withOpacity(0.05),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: const Color(0xFF6C63FF), width: 2),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(_fileName == null ? Icons.cloud_upload_outlined : Icons.check_circle, size: 40, color: const Color(0xFF6C63FF)),
                    const SizedBox(height: 10),
                    Text(_fileName ?? "Tap to select file", style: const TextStyle(fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
            ),
            
            const SizedBox(height: 20),

            // --- 4. UPLOAD BUTTON ---
            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton(
                // Only enable if File is picked AND all Node Slots are filled
                onPressed: (_fileName != null && !_isUploading && !_selectedNodes.contains(null)) 
                    ? _uploadFile 
                    : null,
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6C63FF)),
                child: _isUploading 
                  ? const CircularProgressIndicator(color: Colors.white) 
                  : const Text("Confirm & Upload", style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}