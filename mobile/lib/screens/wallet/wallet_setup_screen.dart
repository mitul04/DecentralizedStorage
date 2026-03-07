// This file defines the WalletSetupScreen, which provides options for the user to either
// create a new wallet or import an existing one using a recovery phrase.
import 'package:flutter/material.dart';
import './create_wallet_screen.dart';
import './import_wallet_screen.dart';

/// WalletSetupScreen is a StatelessWidget that presents the user with two options:
/// 1. Create New Wallet: Navigates to the CreateWalletFlow.
/// 2. Import Wallet: Navigates to the ImportWalletScreen.
class WalletSetupScreen extends StatelessWidget {
  const WalletSetupScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black, // Matches the overall app theme.
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Title for the wallet setup section.
                const Text(
                  "Wallet Setup",
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 32),

                // Button to navigate to the Create New Wallet flow.
                ElevatedButton(
                  onPressed: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const CreateWalletFlow(),
                      ),
                    );
                  },
                  child: const Text("Create New Wallet"),
                ),

                const SizedBox(height: 16),

                // Button to navigate to the Import Wallet screen.
                OutlinedButton(
                  onPressed: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const ImportWalletScreen(),
                      ),
                    );
                  },
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.white,
                    side: const BorderSide(color: Colors.white),
                  ),
                  child: const Text("Import Wallet"),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
