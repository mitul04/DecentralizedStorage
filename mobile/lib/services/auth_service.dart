import 'dart:convert';
import 'package:http/http.dart' as http;
import '../crypto/wallet_service.dart';
import '../storage/secure_storage.dart';

class AuthService {
  static const String baseUrl = "http://YOUR_LOCAL_IP:3000"; // Use your machine's IP, not localhost for mobile

  static Future<void> loginOrRegister() async {
    final address = await SecureStorage.read('wallet_address');
    if (address == null) return;

    // --- 1. REQUEST NONCE ---
    final nonceResponse = await http.post(
      Uri.parse("$baseUrl/auth/nonce"),
      headers: {"Content-Type": "application/json"},
      body: jsonEncode({"wallet_address": address}),
    );

    if (nonceResponse.statusCode != 200) throw Exception("Failed to get nonce");
    final String nonce = jsonDecode(nonceResponse.body)['nonce'];

    // --- 2. SIGN NONCE ---
    final String signature = await WalletService.signMessage(nonce);

    // --- 3. VERIFY & GET JWT ---
    // We try LOGIN first, if it fails with 401, we try REGISTER
    final verifyResponse = await http.post(
      Uri.parse("$baseUrl/auth/verify"),
      headers: {"Content-Type": "application/json"},
      body: jsonEncode({
        "wallet_address": address,
        "nonce": nonce,
        "signature": signature,
        "mode": "LOGIN", // Start with LOGIN
        "role": "CLIENT"
      }),
    );

    if (verifyResponse.statusCode == 401) {
      // Logic for REGISTER if LOGIN fails (Registration flow)
      await _register(address, nonce, signature);
    } else if (verifyResponse.statusCode == 200) {
      final String token = jsonDecode(verifyResponse.body)['token'];
      await SecureStorage.write('jwt_token', token);
      print("🚀 JWT Secured!");
    }
  }

  static Future<void> _register(String address, String nonce, String signature) async {
     final regResponse = await http.post(
      Uri.parse("$baseUrl/auth/verify"),
      headers: {"Content-Type": "application/json"},
      body: jsonEncode({
        "wallet_address": address,
        "nonce": nonce,
        "signature": signature,
        "mode": "REGISTER",
        "role": "CLIENT"
      }),
    );
    
    if (regResponse.statusCode == 200) {
      final String token = jsonDecode(regResponse.body)['token'];
      await SecureStorage.write('jwt_token', token);
      print("✅ Registered and JWT Secured!");
    }
  }
}