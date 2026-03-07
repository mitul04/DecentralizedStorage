import 'package:flutter/material.dart';
import '../../storage/secure_storage.dart';
import '../../main.dart';
import 'wallet_setup_screen.dart';

class WalletGateScreen extends StatefulWidget {
  const WalletGateScreen({super.key});

  @override
  State<WalletGateScreen> createState() => _WalletGateScreenState();
}

class _WalletGateScreenState extends State<WalletGateScreen> {
  bool loading = true;
  bool walletExists = false;

  @override
  void initState() {
    super.initState();
    _checkWallet();
  }

  Future<void> _checkWallet() async {
    final address = await SecureStorage.read('wallet_address');
    setState(() {
      walletExists = address != null;
      loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Center(
        child: loading
            ? const CircularProgressIndicator()
            : walletExists
            ? const MainLayout()
            : const WalletSetupScreen(),
      ),
    );
  }
}