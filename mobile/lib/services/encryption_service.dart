import 'dart:io';
import 'dart:typed_data';
import 'package:encrypt/encrypt.dart' as enc;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class EncryptionService {
  // Save keys locally: Map<CID, KeyString>
  // In a real app, use FlutterSecureStorage
  
  // 1. Generate a random 32-byte key (AES-256)
  String generateRandomKey() {
    final key = enc.Key.fromSecureRandom(32);
    return key.base64;
  }

  // 2. Encrypt a File
  Future<Map<String, dynamic>> encryptFile(File originalFile, String keyString) async {
    try {
      // Setup the Algorithm
      final key = enc.Key.fromBase64(keyString);
      final iv = enc.IV.fromLength(16); // Initialization Vector (Randomness)
      final encrypter = enc.Encrypter(enc.AES(key));

      // Read File Bytes
      Uint8List fileBytes = await originalFile.readAsBytes();

      // Encrypt
      final encrypted = encrypter.encryptBytes(fileBytes, iv: iv);

      // Save to a temporary file
      final directory = await getTemporaryDirectory();
      final tempPath = '${directory.path}/temp_enc_${DateTime.now().millisecondsSinceEpoch}.aes';
      final encryptedFile = File(tempPath);
      await encryptedFile.writeAsBytes(encrypted.bytes);

      return {
        'path': tempPath,
        'iv': iv.base64 // We need this to decrypt later
      };
    } catch (e) {
      throw Exception("Encryption Failed: $e");
    }
  }

  // 3. Save the Key locally linked to the CID
  Future<void> saveKeyForCid(String cid, String key, String iv) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('key_$cid', key);
    await prefs.setString('iv_$cid', iv);
    print("🔐 Key saved securely for CID: $cid");
  }
  
  // (Optional for Demo) Logic to retrieve key
  Future<String?> getKeyForCid(String cid) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('key_$cid');
  }
}