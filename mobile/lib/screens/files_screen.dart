import 'package:flutter/material.dart';
import '../services/blockchain_service.dart';

class FilesScreen extends StatefulWidget {
  const FilesScreen({super.key});

  @override
  State<FilesScreen> createState() => _FilesScreenState();
}

class _FilesScreenState extends State<FilesScreen> {
  final BlockchainService _service = BlockchainService();
  Future<List<Map<String, dynamic>>>? _filesFuture;

  @override
  void initState() {
    super.initState();
    _filesFuture = _initAndLoad();
  }

  Future<List<Map<String, dynamic>>> _initAndLoad() async {
    await _service.init(); // Ensure wallet is connected
    return _service.fetchUserFiles();
  }

  void _refresh() {
    setState(() {
      _filesFuture = _service.fetchUserFiles();
    });
  }

  String _formatSize(String sizeStr) {
    int bytes = int.tryParse(sizeStr) ?? 0;
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("My Cloud"),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _refresh, // Refresh button
          ),
        ],
      ),
      body: FutureBuilder<List<Map<String, dynamic>>>(
        future: _filesFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          
          if (snapshot.hasError) {
            return Center(child: Text("Error: ${snapshot.error}"));
          }

          final files = snapshot.data ?? [];

          if (files.isEmpty) {
            return const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.cloud_off, size: 64, color: Colors.grey),
                  SizedBox(height: 16),
                  Text("No files uploaded yet."),
                ],
              ),
            );
          }

          return ListView.builder(
            padding: const EdgeInsets.all(12),
            itemCount: files.length,
            itemBuilder: (context, index) {
              final file = files[index];
              return Card(
                elevation: 3,
                margin: const EdgeInsets.only(bottom: 12),
                child: ListTile(
                  leading: const CircleAvatar(
                    backgroundColor: Colors.deepPurpleAccent,
                    child: Icon(Icons.insert_drive_file, color: Colors.white),
                  ),
                  title: Text(
                    file['fileName'],
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                  subtitle: Text(
                    "Size: ${_formatSize(file['fileSize'])} • CID: ${file['cid'].substring(0, 8)}...",
                  ),
                  trailing: const Icon(Icons.more_vert),
                ),
              );
            },
          );
        },
      ),
    );
  }
}