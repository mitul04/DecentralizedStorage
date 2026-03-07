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
}

class WalletCreationResult {
  final EthereumAddress address;
  final String mnemonic;

  WalletCreationResult({required this.address, required this.mnemonic});
}
