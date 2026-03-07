import 'dart:typed_data';

import 'package:bip39/bip39.dart' as bip39;
import 'package:bip32/bip32.dart' as bip32;
import 'package:web3dart/web3dart.dart';
import 'package:web3dart/crypto.dart'; // ← REQUIRED

class MnemonicService {
  /// Step 1–2: Generate BIP-39 mnemonic
  static String generateMnemonic() {
    return bip39.generateMnemonic();
  }

  /// Step 3–5: Proper Ethereum key derivation (BIP-44)
  static EthPrivateKey derivePrivateKey(String mnemonic) {
    if (!bip39.validateMnemonic(mnemonic)) {
      throw Exception("Invalid mnemonic");
    }

    // Generate seed from mnemonic
    final Uint8List seed = bip39.mnemonicToSeed(mnemonic);

    // Create HD root key
    final bip32.BIP32 root = bip32.BIP32.fromSeed(seed);

    // Ethereum derivation path
    final bip32.BIP32 child = root.derivePath("m/44'/60'/0'/0/0");

    final Uint8List privateKeyBytes = child.privateKey!;
    return EthPrivateKey.fromHex(bytesToHex(privateKeyBytes));
  }
}
