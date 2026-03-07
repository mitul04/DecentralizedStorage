import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../services/blockchain_service.dart';

class RewardsScreen extends StatefulWidget {
  const RewardsScreen({super.key});

  @override
  State<RewardsScreen> createState() => _RewardsScreenState();
}

class _RewardsScreenState extends State<RewardsScreen> {
  final BlockchainService _service = BlockchainService();
  String _balance = "---";
  bool _isLoading = true;
  bool _isClaiming = false; // 🚨 NEW: Loading state for the claim button

  // 🚨 Make sure this matches your Coordinator's IP!
  final String _coordinatorUrl = "http://127.0.0.1:3000"; 

  @override
  void initState() {
    super.initState();
    _loadBalance();
  }

  Future<void> _loadBalance() async {
    await _service.init();
    final bal = await _service.getRewardTokenBalance();
    if (mounted) {
      setState(() {
        _balance = bal;
        _isLoading = false;
      });
    }
  }

  // 🚨 NEW: The Real Claim Logic!
  Future<void> _claimRewards() async {
    setState(() => _isClaiming = true);

    try {
      final String walletAddress = await _service.getWalletAddress();

      // 1. Ask the Coordinator (The Boss) for the paycheck
      final response = await http.post(
        Uri.parse('$_coordinatorUrl/api/rewards/claim'), // Matches your Express route!
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'walletAddress': walletAddress}),
      );

      if (response.statusCode != 200) {
        throw Exception(jsonDecode(response.body)['error'] ?? "Failed to get signature");
      }

      final payload = jsonDecode(response.body);
      final String signature = payload['signature'];
      final String amountWei = payload['amountWei'];
      final String amountDisplay = payload['amountDisplay'];

      // 2. Submit the signed check to the Smart Contract (The Bank)
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("⏳ Signature received! Submitting to Blockchain..."))
      );

      final txHash = await _service.claimDailyReward(amountWei, signature);

      if (txHash != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("✅ Successfully claimed $amountDisplay DCLD!"), backgroundColor: Colors.green)
        );
        _loadBalance(); // Refresh the UI balance
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("❌ Claim Failed: $e"), backgroundColor: Colors.redAccent)
      );
    } finally {
      if (mounted) setState(() => _isClaiming = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8F9FE),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text("My Rewards", style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
              const SizedBox(height: 20),

              // --- 1. GRADIENT BALANCE CARD ---
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF4facfe), Color(0xFF00f2fe)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(24),
                  boxShadow: [
                    BoxShadow(color: const Color(0xFF4facfe).withOpacity(0.3), blurRadius: 20, offset: const Offset(0, 10)),
                  ],
                ),
                child: Column(
                  children: [
                    _isLoading 
                      ? const CircularProgressIndicator(color: Colors.white)
                      : Text("$_balance DCLD", style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Colors.white)),
                    const SizedBox(height: 8),
                    const Text("Native Storage Token", style: TextStyle(color: Colors.white70)),
                    const SizedBox(height: 24),
                    
                    // 🚨 REAL Claim Button
                    ElevatedButton(
                      onPressed: _isClaiming ? null : _claimRewards,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.white.withOpacity(0.2),
                        foregroundColor: Colors.white,
                        elevation: 0,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
                        padding: const EdgeInsets.symmetric(horizontal: 30, vertical: 12),
                      ),
                      child: _isClaiming 
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                        : const Text("Claim Rewards"),
                    )
                  ],
                ),
              ),

              const SizedBox(height: 30),

              // --- 2. STATS SUMMARY ---
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: [BoxShadow(color: Colors.grey.shade100, blurRadius: 10, offset: const Offset(0, 5))],
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text("Rewards Earned Summary", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                        const SizedBox(height: 5),
                        Text("Total Earned This Month:", style: TextStyle(color: Colors.grey[600])),
                      ],
                    ),
                    const Text("12.5 DCLD", style: TextStyle(fontWeight: FontWeight.bold, color: Colors.pinkAccent, fontSize: 16)),
                  ],
                ),
              ),
              const SizedBox(height: 30),
            ],
          ),
        ),
      ),
    );
  }
}