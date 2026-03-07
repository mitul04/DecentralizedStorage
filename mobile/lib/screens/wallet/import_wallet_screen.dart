// This file defines the ImportWalletScreen, where users can import an existing wallet
// by entering their recovery phrase. It uses WalletService to handle the import logic.
import 'package:flutter/material.dart';
import '../../services/wallet_service.dart';
//import '../wallet_home_screen.dart';
import '../../main.dart';

/// ImportWalletScreen is a StatefulWidget that allows users to import an existing wallet
/// by providing a recovery phrase. It handles the import process and navigation to the home screen.
class ImportWalletScreen extends StatefulWidget {
  const ImportWalletScreen({super.key});

  @override
  State<ImportWalletScreen> createState() => _ImportWalletScreenState();
}

class _ImportWalletScreenState extends State<ImportWalletScreen> {
  // Controller for the text input field where the recovery phrase is entered.
  final controller = TextEditingController();
  // Flag to indicate if the import process is currently loading.
  bool loading = false;
  // Stores any error message that occurs during the import process.
  String? error;

  /// Initiates the wallet import process using the provided recovery phrase.
  /// If successful, navigates to the WalletHomeScreen; otherwise, displays an error.
  Future<void> _import() async {
    setState(() {
      loading = true;
      error = null;
    });

    try {
      await WalletService.importWallet(controller.text.trim());

      // Navigates to the WalletHomeScreen and removes all previous routes from the stack.
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const MainLayout()),
        (_) => false,
      );
    } catch (e) {
      setState(() {
        error = "Invalid recovery phrase";
        loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black, // Sets the background color of the screen.
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text("Import Wallet"), // Title of the app bar.
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              // Text field for entering the recovery phrase.
              TextField(
                controller: controller,
                maxLines: 3,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: "Recovery Phrase",
                  labelStyle: TextStyle(color: Colors.white70),
                  enabledBorder: OutlineInputBorder(
                    borderSide: BorderSide(color: Colors.white54),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderSide: BorderSide(color: Colors.white),
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // Displays an error message if the import fails.
              if (error != null)
                Text(error!, style: const TextStyle(color: Colors.red)),

              const SizedBox(height: 16),

              // Button to trigger the wallet import process.
              ElevatedButton(
                onPressed: loading ? null : _import,
                child: loading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2), // Shows a loading indicator when importing.
                      )
                    : const Text("Import Wallet"),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
