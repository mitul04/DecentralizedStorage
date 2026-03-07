import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:open_filex/open_filex.dart';
import 'encryption_service.dart'; // 🚨 NEW: Import the encryption service

class StorageService {
  final EncryptionService _encryptionService = EncryptionService(); // 🚨 NEW
  
  Future<String> _getDownloadPath() async {
    final directory = await getApplicationDocumentsDirectory();
    final cacheDir = Directory('${directory.path}/ipfs_cache');
    
    if (!await cacheDir.exists()) {
      await cacheDir.create(recursive: true);
    }
    return cacheDir.path;
  }

  String _getLocalFileName(String cid, String originalFileName) {
    if (!originalFileName.contains('.')) return cid;
    final ext = originalFileName.split('.').last;
    return '$cid.$ext';
  }

  Future<File?> getCachedFile(String cid, String originalFileName) async {
    final dirPath = await _getDownloadPath();
    
    // We check for the readable version (without .enc)
    String cleanName = originalFileName.replaceAll('.enc', '');
    final localName = _getLocalFileName(cid, cleanName);
    
    final file = File('$dirPath/$localName');
    
    if (await file.exists()) {
      print("✅ Cache Hit: Found $localName locally.");
      return file;
    }
    return null;
  }

  Future<File?> downloadFile(String cid, String fileName, String gatewayUrl) async {
    try {
      print("⬇️ Cache Miss. Downloading $cid from Gateway...");
      
      final url = Uri.parse('$gatewayUrl/retrieve/$cid'); 
      final response = await http.get(url);

      if (response.statusCode == 200) {
        final dirPath = await _getDownloadPath();
        final localName = _getLocalFileName(cid, fileName);
        File downloadedFile = File('$dirPath/$localName'); 
        
        await downloadedFile.writeAsBytes(response.bodyBytes);
        print("💾 Raw file saved to Mobile Storage: ${downloadedFile.path}");
        
        // 🚨 NEW: THE DECRYPTION CHECK
        final credentials = await _encryptionService.getCredentialsForCid(cid);
        
        if (credentials != null) {
            print("🔓 Encrypted file detected! Decrypting automatically...");
            File readableFile = await _encryptionService.decryptFile(
                downloadedFile, 
                credentials['key']!, 
                credentials['iv']!, 
                fileName
            );
            
            // Delete the scrambled raw file to save space
            if (await downloadedFile.exists()) {
                await downloadedFile.delete(); 
            }
            
            return readableFile; // Return the readable version!
        }

        // If no credentials found, it was uploaded normally (unencrypted)
        return downloadedFile;
        
      } else {
        print("❌ Download Failed: ${response.statusCode}");
        return null;
      }
    } catch (e) {
      print("❌ Error downloading: $e");
      return null;
    }
  }

  Future<void> openFile(File file) async {
    final result = await OpenFilex.open(file.path);
    print("📂 Opening File Result: ${result.type} - ${result.message}");
  }
}