import 'dart:typed_data';
import 'package:web3dart/web3dart.dart';
import 'mnemonic_service.dart';
//import 'keystore_service.dart';
import '../storage/secure_storage.dart';
import 'package:bip39/bip39.dart' as bip39;
//import 'package:bip32/bip32.dart' as bip32;
import 'package:web3dart/crypto.dart';

class WalletService {
  static Future<WalletCreationResult> createWallet() async {
    final mnemonic = MnemonicService.generateMnemonic();
    final privateKey = MnemonicService.derivePrivateKey(mnemonic);
    final address = privateKey.address;

    final privateKeyHex = bytesToHex(privateKey.privateKey, include0x: false);

    assert(privateKeyHex.length == 64);

    await SecureStorage.write('wallet_private_key', privateKeyHex);
    await SecureStorage.write('wallet_address', address.hex);

    return WalletCreationResult(address: address, mnemonic: mnemonic);
  }

  static Future<EthereumAddress> importWallet(String mnemonic) async {
    if (!bip39.validateMnemonic(mnemonic)) {
      throw Exception("Invalid mnemonic");
    }

    final privateKey = MnemonicService.derivePrivateKey(mnemonic);
    final address = privateKey.address;

    final privateKeyHex = bytesToHex(privateKey.privateKey, include0x: false);

    assert(privateKeyHex.length == 64);

    await SecureStorage.write('wallet_private_key', privateKeyHex);
    await SecureStorage.write('wallet_address', address.hex);

    return address;
  }

  // Signs a raw string message (nonce) using the stored private key
  static Future<String> signMessage(String message) async {
    // 1. Retrieve the private key from secure storage
    final String? privKeyHex = await SecureStorage.read('wallet_private_key');
    if (privKeyHex == null) throw Exception("No wallet found on device");

    // 2. Convert hex string to EthPrivateKey object
    final EthPrivateKey credentials = EthPrivateKey.fromHex(privKeyHex);

    // 3. Sign the message (this automatically applies the Ethereum prefix: 
    // "\x19Ethereum Signed Message:\n" + len(msg))
    final Uint8List signature = credentials.signPersonalMessageToUint8List(
      Uint8List.fromList(message.codeUnits),
    );

    // 4. Return as a hex string for the backend
    return bytesToHex(signature, include0x: true);
  }
}

class WalletCreationResult {
  final EthereumAddress address;
  final String mnemonic;

  WalletCreationResult({required this.address, required this.mnemonic});
}
