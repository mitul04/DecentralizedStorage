import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:web3dart/web3dart.dart';
import 'package:web3dart/crypto.dart'; // 🚨 NEW: Needed to convert the hex signature to bytes
import 'package:shared_preferences/shared_preferences.dart';
import '../storage/secure_storage.dart'; // 🚨 NEW: Import Tom's secure storage

class BlockchainService {
  late String _rpcUrl;
  late String _fileAddr;
  late String _nodeAddr;
  late String _tokenAddr;

  late Web3Client _client;
  late Credentials _credentials;
  late EthereumAddress _ownAddress;

  late DeployedContract _fileContract; 
  late DeployedContract _nodeContract;
  late ContractAbi _rewardTokenAbiDefinition;

Future<void> init() async {
    try {
      // 1. Load your Dynamic Config
      final String configString = await rootBundle.loadString('assets/app_config.json');
      final Map<String, dynamic> config = jsonDecode(configString);

      _rpcUrl = config['rpcUrl'];
      _fileAddr = config['fileRegistry'];
      _nodeAddr = config['nodeRegistry'];
      _tokenAddr = config['rewardToken'];

      print("⚙️  Dynamic Config Loaded: RPC=$_rpcUrl");

      _client = Web3Client(_rpcUrl, http.Client());

      // 🚨 NEW: FETCH THE REAL USER'S KEY FROM TOM'S SECURE STORAGE
      final String? storedKeyHex = await SecureStorage.read('wallet_private_key');
      
      if (storedKeyHex == null || storedKeyHex.isEmpty) {
         // If this happens, it means the user hasn't gone through Tom's "Create Wallet" screen yet!
         throw Exception("No wallet found! Please create or import a wallet first.");
      }

      // Load the user's actual credentials into your engine
      _credentials = EthPrivateKey.fromHex(storedKeyHex);
      _ownAddress = await _credentials.extractAddress();
      
      print("📱 Live Wallet Connected: $_ownAddress");
      
      await _loadContracts();

    } catch (e) {
      print("❌ CRITICAL INIT ERROR: $e");
    }
  }

  // 🚨 NEW: Get the connected wallet address for the UI
  Future<String> getWalletAddress() async {
    return _ownAddress.hexEip55; 
  }

  Future<void> _cacheBalance(String balance) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('cached_balance', balance);
  }

  Future<String> getCachedBalance() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('cached_balance') ?? "0.00";
  }

  Future<void> _cacheFiles(List<Map<String, dynamic>> files) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      List<Map<String, dynamic>> safeList = files.map((f) {
        return {
          'owner': f['owner'].toString(),
          'cid': f['cid'].toString(),
          'fileName': f['fileName'].toString(),
          'fileType': f['fileType'].toString(),
          'hosts': f['hosts'],
          'fileSize': f['fileSize'].toString(),
          'timestamp': f['timestamp'].toString(),
          'targetReplication': f['targetReplication'].toString(),
        };
      }).toList();

      String jsonString = jsonEncode(safeList); 
      await prefs.setString('cached_files', jsonString);
      print("💾 Files Cached Successfully: ${safeList.length} items");
    } catch (e) {
      print("⚠️ Cache Write Failed: $e");
    }
  }

  Future<List<Map<String, dynamic>>> getCachedFiles() async {
    final prefs = await SharedPreferences.getInstance();
    String? jsonString = prefs.getString('cached_files');
    if (jsonString == null) return [];
    try {
      List<dynamic> decoded = jsonDecode(jsonString);
      return List<Map<String, dynamic>>.from(decoded);
    } catch (e) {
      return [];
    }
  }

  Future<void> _loadContracts() async {
    String fileAbi = await rootBundle.loadString("assets/file_registry_abi.json");
    _fileContract = DeployedContract(ContractAbi.fromJson(fileAbi, "FileRegistry"), EthereumAddress.fromHex(_fileAddr));

    String nodeAbi = await rootBundle.loadString("assets/node_registry_abi.json");
    _nodeContract = DeployedContract(ContractAbi.fromJson(nodeAbi, "StorageNodeRegistry"), EthereumAddress.fromHex(_nodeAddr));

    String tokenAbiString = await rootBundle.loadString("assets/reward_token_abi.json");
    _rewardTokenAbiDefinition = ContractAbi.fromJson(tokenAbiString, "RewardToken");
  }

  Future<String> getRewardTokenBalance() async {
    try {
      // Create the Contract Object directly from the config string!
      final tokenContract = DeployedContract(
        _rewardTokenAbiDefinition, 
        EthereumAddress.fromHex(_tokenAddr)
      );

      final balanceFunc = tokenContract.function('balanceOf');

      // Query the blockchain
      final balanceResult = await _client.call(
        contract: tokenContract,
        function: balanceFunc,
        params: [_ownAddress],
      );

      // Math conversions
      final balanceBigInt = balanceResult.first as BigInt;
      
      // Convert Wei (18 decimals) to Human Readable Number
      double balance = balanceBigInt / BigInt.from(10).pow(18);
      
      return balance.toStringAsFixed(2);

    } catch (e) {
      print("⚠️ Failed to load DCLD token balance: $e");
      return "0.00";
    }
  }

  // 🚨 NEW: The function that actually submits the Boss's paycheck to the Blockchain!
  Future<String?> claimDailyReward(String amountWei, String signature) async {
    try {
      final function = _nodeContract.function('claimDailyReward');
      
      // Convert the Hex string signature into raw bytes for Solidity
      final sigBytes = hexToBytes(signature);
      
      final txHash = await _client.sendTransaction(
        _credentials,
        Transaction.callContract(
          contract: _nodeContract,
          function: function,
          parameters: [BigInt.parse(amountWei), sigBytes],
        ),
        chainId: 31337,
      );
      
      print("🎉 Reward successfully claimed on-chain: $txHash");
      return txHash;
    } catch (e) {
      print("❌ Smart Contract execution failed: $e");
      rethrow;
    }
  }

  Future<List<Map<String, dynamic>>> fetchUserFiles() async {
    return _fetchFilesFromContract('getMyFiles');
  }

  Future<List<Map<String, dynamic>>> fetchReceivedFiles() async {
    return _fetchFilesFromContract('getSharedFiles');
  }

  Future<List<Map<String, dynamic>>> _fetchFilesFromContract(String functionName) async {
    try {
      final function = _fileContract.function(functionName);
      final result = await _client.call(contract: _fileContract, function: function, params: [], sender: _ownAddress);
      List<dynamic> rawFiles = result[0];

      List<Map<String, dynamic>> cleanFiles = rawFiles.map((fileData) {
        return {
          'owner': fileData[0].toString(),
          'cid': fileData[1].toString(),
          'fileName': fileData[2].toString(),
          'fileType': fileData[3].toString(),
          'fileSize': fileData[4].toString(),
          'timestamp': fileData[5].toString(),
          'targetReplication': fileData[6].toString(),
          'hosts': (fileData[7] as List).map((e) => e.toString()).toList(),
        };
      }).toList();

      if (functionName == 'getMyFiles') await _cacheFiles(cleanFiles);
      return cleanFiles;
    } catch (e) {
      print("⚠️ Network error fetching $functionName: $e");
      if (functionName == 'getMyFiles') return await getCachedFiles();
      return []; 
    }
  }

  Future<void> storeFileOnChain(String fileName, String cid, int fileSize, int replication, List<String> hostAddresses) async {
    try {
      final function = _fileContract.function('registerFile'); 
      List<EthereumAddress> ethAddresses = hostAddresses.map((a) => EthereumAddress.fromHex(a)).toList();

      await _client.sendTransaction(
        _credentials,
        Transaction.callContract(
          contract: _fileContract,
          function: function,
          parameters: [cid, fileName, "unknown", BigInt.from(fileSize), ethAddresses, BigInt.from(replication)],
        ),
        chainId: 31337,
      );
    } catch (e) {
      print("❌ Blockchain Error: $e");
    }
  }
  
  Future<String> getBalance() async {
    try {
      EtherAmount balance = await _client.getBalance(_ownAddress);
      String val = balance.getValueInUnit(EtherUnit.ether).toStringAsFixed(6);
      _cacheBalance(val); 
      return val;
    } catch (e) {
      return await getCachedBalance();
    }
  }

  Future<List<Map<String, dynamic>>> getAvailableNodes() async {
    try {
      final function = _nodeContract.function('getAllNodes');
      final result = await _client.call(contract: _nodeContract, function: function, params: []);

      List<dynamic> nodeAddresses = result[0];
      List<Map<String, dynamic>> detailedNodes = [];

      for (var address in nodeAddresses) {
        final profileFunc = _nodeContract.function('nodes');
        final profile = await _client.call(contract: _nodeContract, function: profileFunc, params: [address]);

        detailedNodes.add({
          'address': address.toString(),
          'ip': profile[0].toString(),
          'freeSpace': profile[2].toString(),
          'reputation': profile[4].toString(),
        });
      }
      return detailedNodes;
    } catch (e) {
      print("❌ Error fetching node list: $e");
      return [];
    }
  }

  Future<String?> uploadFileToSpecificNode(String filePath, String fileName, String targetUrl) async {
    try {
      var request = http.MultipartRequest('POST', Uri.parse(targetUrl));
      request.files.add(await http.MultipartFile.fromPath('file', filePath, filename: fileName));

      var response = await request.send();

      if (response.statusCode == 200) {
        return await response.stream.bytesToString();
      } else {
        return null;
      }
    } catch (e) {
      print("❌ Error uploading: $e");
      return null;
    }
  }
}