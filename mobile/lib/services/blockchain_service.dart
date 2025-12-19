import 'dart:convert';
import 'dart:math';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:web3dart/web3dart.dart';
import 'package:shared_preferences/shared_preferences.dart';
class BlockchainService {
  // 1. GATEWAY IP: Still needed so the phone can reach the Blockchain (RPC)
  // Run `ipconfig` to verify this hasn't changed!
  static const String _baseIp = "192.168.43.118"; 
  final String _rpcUrl = "http://$_baseIp:9545"; 

  // 2. IDENTITY: The 'User' Account
  final String _privateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

  late Web3Client _client;
  late Credentials _credentials;
  late EthereumAddress _ownAddress;
  
  late DeployedContract _fileContract; // The App Logic
  late DeployedContract _nodeContract; // The "Phonebook" of Nodes

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
    final prefs = await SharedPreferences.getInstance();
    // Convert List<Map> to a JSON String
    String jsonString = jsonEncode(files); 
    await prefs.setString('cached_files', jsonString);
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

  Future<void> init() async {
    _client = Web3Client(_rpcUrl, http.Client());
    _credentials = EthPrivateKey.fromHex(_privateKey);
    _ownAddress = await _credentials.extractAddress();
    print("📱 Wallet Connected: $_ownAddress");
    
    await _loadContracts();
  }

  Future<void> _loadContracts() async {
    // --- CONTRACT 1: FILE REGISTRY ---
    String fileAbi = await rootBundle.loadString("assets/abi.json");
    
    // ⚠️ UPDATE ME: Check your deploy logs for "FileRegistry deployed to"
    String fileAddr = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"; 

    _fileContract = DeployedContract(
      ContractAbi.fromJson(fileAbi, "FileRegistry"),
      EthereumAddress.fromHex(fileAddr),
    );

    // --- CONTRACT 2: NODE REGISTRY (NEW) ---
    String nodeAbi = await rootBundle.loadString("assets/node_registry_abi.json");
    
    // ⚠️ UPDATE ME: Check your deploy logs for "StorageNodeRegistry deployed to"
    // (Ensure this is DIFFERENT from the fileAddr above)
    String nodeAddr = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"; 

    _nodeContract = DeployedContract(
      ContractAbi.fromJson(nodeAbi, "StorageNodeRegistry"),
      EthereumAddress.fromHex(nodeAddr),
    );
  }

  // --- 🕵️‍♂️ DISCOVERY: The Decentralized "Google Search" ---
  Future<String?> findBestNode() async {
    try {
      print("🔍 Searching for active storage nodes...");
      final function = _nodeContract.function('getAllNodes');
      
      final result = await _client.call(
        contract: _nodeContract,
        function: function,
        params: [],
      );

      List<dynamic> nodeAddresses = result[0];
      if (nodeAddresses.isEmpty) {
        print("❌ No nodes registered on blockchain!");
        return null;
      }

      // Load Balancing: Pick a random node from the list
      final randomAddress = nodeAddresses[Random().nextInt(nodeAddresses.length)];
      
      // Get that node's profile (Index 0 is the IP string)
      final profileFunc = _nodeContract.function('nodes');
      final profileResult = await _client.call(
        contract: _nodeContract,
        function: profileFunc,
        params: [randomAddress],
      );

      String ipAddress = profileResult[0]; // This comes from Daemon "192.168..."
      
      print("✅ Found Node: $ipAddress");
      return "$ipAddress/upload"; // Construct the API endpoint

    } catch (e) {
      print("❌ Discovery Error: $e");
      return null;
    }
  }

  // --- UPLOAD: Now uses Dynamic Discovery ---
  Future<String?> uploadFileToStorage(String filePath, String fileName) async {
    try {
      // 1. Ask Blockchain: "Where should I put this?"
      final nodeUrl = await findBestNode();
      
      if (nodeUrl == null) {
        print("❌ No available nodes found.");
        return null;
      }

      // 2. Upload to the discovered URL
      var request = http.MultipartRequest('POST', Uri.parse(nodeUrl));
      request.files.add(await http.MultipartFile.fromPath('file', filePath, filename: fileName));

      print("📤 Uploading $fileName to $nodeUrl...");
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

      _cacheFiles(cleanFiles);
      
      return cleanFiles;
      
    } catch (e) {
      print("❌ Error fetching files: $e");
      return [];
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
      print("⚠️ Network error, returning cached balance");
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