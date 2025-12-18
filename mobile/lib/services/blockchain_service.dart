import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:web3dart/web3dart.dart';

class BlockchainService {
  // Android Emulator -> Physical device
  static const String _baseIp = "10.8.1.84";

  final String _rpcUrl = "http://$_baseIp:9545"; 
  final String _wsUrl = "ws://$_baseIp:9545"; 

  // Storage Server URL (Port 3000)
  final String _storageUrl = "http://$_baseIp:3000/upload";

  // Account #1 Private Key (Pre-funded with ETH & STOR from our scripts)
  final String _privateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

  late Web3Client _client;
  late Credentials _credentials;
  late EthereumAddress _ownAddress;
  late DeployedContract _contract;

  Future<void> init() async {
    _client = Web3Client(_rpcUrl, http.Client());
    _credentials = EthPrivateKey.fromHex(_privateKey);
    _ownAddress = await _credentials.extractAddress();
    print("📱 Wallet Connected: $_ownAddress");
    await _loadContract();
  }

  Future<void> _loadContract() async {
    String abi = await rootBundle.loadString("assets/abi.json");
    String contractAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // Check this!

    _contract = DeployedContract(
      ContractAbi.fromJson(abi, "FileRegistry"),
      EthereumAddress.fromHex(contractAddress),
    );
  }

  Future<String> getBalance() async {
    EtherAmount balance = await _client.getBalance(_ownAddress);
    return balance.getValueInUnit(EtherUnit.ether).toStringAsFixed(6);
  }

Future<String?> uploadFileToStorage(String filePath, String fileName) async {
    try {
      var request = http.MultipartRequest('POST', Uri.parse(_storageUrl));
      request.files.add(await http.MultipartFile.fromPath('file', filePath, filename: fileName));

      print("📤 Uploading $fileName to $_storageUrl...");
      var response = await request.send();

      if (response.statusCode == 200) {
        var cid = await response.stream.bytesToString();
        print("✅ Storage Success! CID: $cid");
        return cid;
      } else {
        print("❌ Storage Failed: ${response.statusCode}");
        return null;
      }
    } catch (e) {
      print("❌ Error uploading: $e");
      return null;
    }
  }

  // 2. Save Record to Blockchain
  Future<void> storeFileOnChain(String fileName, String cid, int fileSize) async {
    try {
      print("🔗 Writing to Blockchain...");
      final function = _contract.function('registerFile'); 
      
      await _client.sendTransaction(
        _credentials,
        Transaction.callContract(
          contract: _contract,
          function: function,
          parameters: [
            cid,                    // 1. _cid
            fileName,               // 2. _fileName
            "unknown",              // 3. _fileType (We'll just use a placeholder for now)
            BigInt.from(fileSize),  // 4. _fileSize
            <EthereumAddress>[]     // 5. _hosts (Empty list - nodes will pick it up later)
          ],
        ),
        chainId: 31337,
      );
      print("🎉 Blockchain Transaction Complete!");
    } catch (e) {
      print("❌ Blockchain Error: $e");
    }
  }
}

