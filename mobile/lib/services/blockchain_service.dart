import 'dart:convert';
// import 'dart:math';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:web3dart/web3dart.dart';
import 'package:shared_preferences/shared_preferences.dart';
class BlockchainService {
  // 1. DYNAMIC CONFIG VARIABLES (Loaded from assets/app_config.json)
  late String _rpcUrl;
  late String _fileAddr;
  late String _nodeAddr;

  // 2. IDENTITY: The 'User' Account
  final String _privateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

  late Web3Client _client;
  late Credentials _credentials;
  late EthereumAddress _ownAddress;
  
  late DeployedContract _fileContract; 
  late DeployedContract _nodeContract; 

  // --- CACHE: BALANCE ---
  Future<void> _cacheBalance(String balance) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('cached_balance', balance);
  }

  Future<String> getCachedBalance() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('cached_balance') ?? "0.00";
  }

  // --- CACHE: FILES ---
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

  // --- INIT: LOAD CONFIG & CONNECT ---
  Future<void> init() async {
    try {
      // 1. Load the Auto-Generated Config
      // This file was created by your 'deploy.ts' script!
      final String configString = await rootBundle.loadString('assets/app_config.json');
      final Map<String, dynamic> config = jsonDecode(configString);

      // 2. Set Variables dynamically
      _rpcUrl = config['rpcUrl'];
      _fileAddr = config['fileRegistry'];
      _nodeAddr = config['nodeRegistry'];

      print("⚙️  Dynamic Config Loaded: RPC=$_rpcUrl");

      // 3. Connect Web3
      _client = Web3Client(_rpcUrl, http.Client());
      _credentials = EthPrivateKey.fromHex(_privateKey);
      _ownAddress = await _credentials.extractAddress();
      print("📱 Wallet Connected: $_ownAddress");
      
      await _loadContracts();

    } catch (e) {
      print("❌ CRITICAL INIT ERROR: Could not load config.");
      print("👉 Make sure you ran 'npx hardhat run scripts/deploy.ts'!");
      print("Error details: $e");
    }
  }

  Future<void> _loadContracts() async {
    // --- CONTRACT 1: FILE REGISTRY ---
    String fileAbi = await rootBundle.loadString("assets/abi.json");
    _fileContract = DeployedContract(
      ContractAbi.fromJson(fileAbi, "FileRegistry"),
      EthereumAddress.fromHex(_fileAddr), // Use dynamic address
    );

    // --- CONTRACT 2: NODE REGISTRY ---
    String nodeAbi = await rootBundle.loadString("assets/node_registry_abi.json");
    _nodeContract = DeployedContract(
      ContractAbi.fromJson(nodeAbi, "StorageNodeRegistry"),
      EthereumAddress.fromHex(_nodeAddr), // Use dynamic address
    );
  }

  // --- READ: Fetch Files ---
  Future<List<Map<String, dynamic>>> fetchUserFiles() async {
    try {
      final function = _fileContract.function('getMyFiles');
      
      final result = await _client.call(
        contract: _fileContract,
        function: function,
        params: [],
        sender: _ownAddress,
      );

      List<dynamic> rawFiles = result[0];

      List<Map<String, dynamic>> cleanFiles = rawFiles.map((fileData) {
        return {
          'owner': fileData[0].toString(),
          'cid': fileData[1].toString(),
          'fileName': fileData[2].toString(),
          'fileType': fileData[3].toString(),
          'hosts': (fileData[4] as List).map((e) => e.toString()).toList(),
          'fileSize': fileData[5].toString(),
          'timestamp': fileData[6].toString(),
          'targetReplication': fileData[7].toString(),
        };
      }).toList();

      await _cacheFiles(cleanFiles);
      
      return cleanFiles;
      
    } catch (e) {
      print("⚠️ Network unreachable for Files. Loading cache... ($e)");
      return await getCachedFiles(); // Auto-fallback
    }
  }

  // --- WRITE: Register on Blockchain ---
  Future<void> storeFileOnChain(String fileName, String cid, int fileSize, int replication, String firstHostAddress) async {
    try {
      print("🔗 Writing to Blockchain (Host: $firstHostAddress)...");
      final function = _fileContract.function('registerFile'); 
      
      await _client.sendTransaction(
        _credentials,
        Transaction.callContract(
          contract: _fileContract,
          function: function,
          parameters: [
            cid, 
            fileName, 
            "unknown", 
            BigInt.from(fileSize), 
            [EthereumAddress.fromHex(firstHostAddress)],
            BigInt.from(replication)
          ],
        ),
        chainId: 31337,
      );
      print("🎉 Blockchain Transaction Complete!");
    } catch (e) {
      print("❌ Blockchain Error: $e");
    }
  }
  
  Future<String> getBalance() async {
    try {
      EtherAmount balance = await _client.getBalance(_ownAddress);
      String val = balance.getValueInUnit(EtherUnit.ether).toStringAsFixed(6);
      
      // Save for offline use
      _cacheBalance(val); 
      return val;
    } catch (e) {
      print("⚠️ Network unreachable for Balance. Using Cache... ($e)");
      return await getCachedBalance();
    }
  }

  // Fetch ALL registered nodes with their details
  Future<List<Map<String, dynamic>>> getAvailableNodes() async {
    try {
      final function = _nodeContract.function('getAllNodes');
      final result = await _client.call(
        contract: _nodeContract,
        function: function,
        params: [],
      );

      List<dynamic> nodeAddresses = result[0];
      List<Map<String, dynamic>> detailedNodes = [];

      for (var address in nodeAddresses) {
        final profileFunc = _nodeContract.function('nodes');
        final profile = await _client.call(
          contract: _nodeContract,
          function: profileFunc,
          params: [address],
        );

        // profile structure: [ipAddress, totalCap, freeCap, lastHeartbeat, reputation, isMobile, isRegistered]
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

  // Takes a specific URL string
  Future<String?> uploadFileToSpecificNode(String filePath, String fileName, String targetUrl) async {
    try {
      var request = http.MultipartRequest('POST', Uri.parse(targetUrl));
      request.files.add(await http.MultipartFile.fromPath('file', filePath, filename: fileName));

      print("📤 Uploading $fileName to $targetUrl...");
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
}