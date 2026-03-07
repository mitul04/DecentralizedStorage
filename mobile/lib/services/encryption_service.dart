import 'dart:io';
import 'dart:typed_data';
import 'package:encrypt/encrypt.dart' as enc;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class EncryptionService {
  
  // 1. Generate a random 32-byte key (AES-256)
  String generateRandomKey() {
    final key = enc.Key.fromSecureRandom(32);
    return key.base64;
  }

  // 2. Encrypt a File
  Future<Map<String, dynamic>> encryptFile(File originalFile, String keyString) async {
    try {
      final key = enc.Key.fromBase64(keyString);
      final iv = enc.IV.fromLength(16); 
      final encrypter = enc.Encrypter(enc.AES(key));

      Uint8List fileBytes = await originalFile.readAsBytes();
      final encrypted = encrypter.encryptBytes(fileBytes, iv: iv);

      final directory = await getTemporaryDirectory();
      final tempPath = '${directory.path}/temp_enc_${DateTime.now().millisecondsSinceEpoch}.aes';
      final encryptedFile = File(tempPath);
      await encryptedFile.writeAsBytes(encrypted.bytes);

      return {
        'path': tempPath,
        'iv': iv.base64 
      };
    } catch (e) {
      throw Exception("Encryption Failed: $e");
    }
  }

  // 🚨 NEW: 3. Decrypt a File
  Future<File> decryptFile(File encryptedFile, String keyString, String ivString, String originalFileName) async {
    try {
      final key = enc.Key.fromBase64(keyString);
      final iv = enc.IV.fromBase64(ivString);
      final encrypter = enc.Encrypter(enc.AES(key));

      Uint8List encryptedBytes = await encryptedFile.readAsBytes();
      
      // We use enc.Encrypted to wrap the raw bytes before decrypting
      final decryptedBytes = encrypter.decryptBytes(enc.Encrypted(encryptedBytes), iv: iv);

      // Save the readable file back to disk
      final directory = await getApplicationDocumentsDirectory();
      
      // Clean the ".enc" off the name if it exists, otherwise use original
      String cleanName = originalFileName.replaceAll('.enc', '');
      final decryptedPath = '${directory.path}/decrypted_$cleanName';
      
      final decryptedFile = File(decryptedPath);
      await decryptedFile.writeAsBytes(decryptedBytes);

      return decryptedFile;
    } catch (e) {
      throw Exception("Decryption Failed: $e");
    }
  }

  // 4. Save the Key & IV locally linked to the CID
  Future<void> saveKeyForCid(String cid, String key, String iv) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('key_$cid', key);
    await prefs.setString('iv_$cid', iv);
    print("🔐 Key & IV saved securely for CID: $cid");
  }
  
  // 🚨 FIXED: Now returns BOTH the Key and the IV!
  Future<Map<String, String>?> getCredentialsForCid(String cid) async {
    final prefs = await SharedPreferences.getInstance();
    final key = prefs.getString('key_$cid');
    final iv = prefs.getString('iv_$cid');
    
    if (key != null && iv != null) {
      return {'key': key, 'iv': iv};
    }
    return null; // Not an encrypted file, or key is missing
  }
}