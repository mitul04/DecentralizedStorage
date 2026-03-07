import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/blockchain_service.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final BlockchainService _service = BlockchainService();
  String _ethBalance = "...";
  String _dcldBalance = "..."; 
  String _walletAddress = "...";

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    await _service.init();
    
    // Fetch all three data points from your engine
    String address = await _service.getWalletAddress();
    String eth = await _service.getBalance();
    String dcld = await _service.getRewardTokenBalance(); 
    
    if (mounted) {
      setState(() {
        _walletAddress = address;
        _ethBalance = eth;
        _dcldBalance = dcld;
      });
    }
  }

  // Helper to format the long wallet address (e.g., 0x1234...ABCD)
  String _shortenAddress(String address) {
    if (address == "...") return address;
    if (address.length < 10) return address;
    return "${address.substring(0, 10)}...${address.substring(address.length - 10)}";
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _loadData,
      color: const Color(0xFF6C63FF),
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text("Hello, User! 👋", style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
              const Text("Welcome to DeCloud", style: TextStyle(color: Colors.grey)),
              const SizedBox(height: 24),

              // --- GRADIENT DASHBOARD CARD ---
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF6C63FF), Color(0xFF4facfe)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF6C63FF).withOpacity(0.3),
                      blurRadius: 20,
                      offset: const Offset(0, 10),
                    )
                  ]
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // 1. WALLET ADDRESS ROW
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text("Connected Wallet", style: TextStyle(color: Colors.white70, fontSize: 12)),
                            const SizedBox(height: 4),
                            Text(_shortenAddress(_walletAddress), 
                              style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w500, fontFamily: 'monospace')),
                          ],
                        ),
                        IconButton(
                          icon: const Icon(Icons.copy, color: Colors.white70, size: 20),
                          onPressed: () {
                            if (_walletAddress != "...") {
                              Clipboard.setData(ClipboardData(text: _walletAddress));
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text("Wallet Address Copied!"), duration: Duration(seconds: 2))
                              );
                            }
                          },
                        )
                      ],
                    ),
                    
                    const SizedBox(height: 16),
                    Container(height: 1, color: Colors.white.withOpacity(0.2)),
                    const SizedBox(height: 16),

                    // 2. DCLD TOKENS (Primary Focus)
                    const Text("Storage Tokens (DCLD)", style: TextStyle(color: Colors.white70, fontSize: 14)),
                    const SizedBox(height: 4),
                    Text("$_dcldBalance DCLD", 
                      style: const TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.bold)),

                    const SizedBox(height: 16),

                    // 3. ETH GAS (Secondary Focus)
                    const Text("Network Gas", style: TextStyle(color: Colors.white70, fontSize: 12)),
                    const SizedBox(height: 4),
                    Text("$_ethBalance ETH", 
                      style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w500)),
                  ],
                ),
              ),
              
              const SizedBox(height: 30),
              
              // You can add more widgets here below the card (like quick actions or recent uploads)
            ],
          ),
        ),
      ),
    );
  }
}