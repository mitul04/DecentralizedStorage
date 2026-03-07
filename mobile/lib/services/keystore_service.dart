import 'dart:convert';
import 'package:cryptography/cryptography.dart';

class KeystoreService {
  static final _algo = AesGcm.with256bits();

  static Future<SecretKey> generateAesKey() async {
    return _algo.newSecretKey();
  }

  static Future<Map<String, String>> encrypt(
    SecretKey key,
    String plaintext,
  ) async {
    final nonce = _algo.newNonce();
    final secretBox = await _algo.encrypt(
      utf8.encode(plaintext),
      secretKey: key,
      nonce: nonce,
    );

    return {
      'cipher': base64Encode(secretBox.cipherText),
      'nonce': base64Encode(secretBox.nonce),
      'mac': base64Encode(secretBox.mac.bytes),
    };
  }
}
