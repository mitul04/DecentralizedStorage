// This file defines the CreateWalletFlow, which handles the process of generating a new wallet.
// It uses WalletService to create the wallet and displays the generated mnemonic phrase for backup.
import 'package:flutter/material.dart';
import '../../services/wallet_service.dart';
import './mnemonic_backup_widget.dart';
//import './wallet_home_screen.dart';
import '../../main.dart';

/// CreateWalletFlow is a StatefulWidget that orchestrates the creation of a new cryptocurrency wallet.
/// It generates a mnemonic phrase and guides the user to back it up.
class CreateWalletFlow extends StatefulWidget {
  const CreateWalletFlow({super.key});

  @override
  State<CreateWalletFlow> createState() => _CreateWalletFlowState();
}

class _CreateWalletFlowState extends State<CreateWalletFlow> {
  // Stores the generated mnemonic phrase for the new wallet.
  String? mnemonic;
  // Flag to indicate if the wallet creation process is in progress.
  bool loading = true;

  @override
  void initState() {
    super.initState();
    // Initiates the wallet creation process when the state is initialized.
    _createWallet();
  }

  /// Creates a new wallet using [WalletService] and stores the generated mnemonic.
  /// Updates [mnemonic] and [loading] accordingly.
  Future<void> _createWallet() async {
    final result = await WalletService.createWallet();
    setState(() {
      mnemonic = result.mnemonic;
      loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black, // Sets the background color of the screen.
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text("Backup Recovery Phrase"), // Title of the app bar.
      ),
      body: SafeArea(
        child: loading
            ? const Center(child: CircularProgressIndicator()) // Shows a loading indicator during wallet creation.
            : MnemonicBackupWidget(
                mnemonic: mnemonic!, // Displays the generated mnemonic for backup.
                onConfirmed: () {
                  // Wipes the mnemonic from memory after confirmation for security.
                  mnemonic = null;

                  // Navigates back to the previous screen (WalletGateScreen) after successful backup.
                  Navigator.pushAndRemoveUntil(
                    context,
                    MaterialPageRoute(builder: (_) => const MainLayout()),
                    (_) => false,
                  );
                  // WalletGateScreen will re-evaluate and show WalletHome
                },
              ),
      ),
    );
  }
}
