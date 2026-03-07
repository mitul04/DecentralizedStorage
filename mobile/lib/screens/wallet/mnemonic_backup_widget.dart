import 'package:flutter/material.dart';

class MnemonicBackupWidget extends StatelessWidget {
  final String mnemonic;
  final VoidCallback onConfirmed;

  const MnemonicBackupWidget({
    super.key,
    required this.mnemonic,
    required this.onConfirmed,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          "Backup your recovery phrase",
          // Use copyWith to keep existing size/weight but change color
          style: Theme.of(
            context,
          ).textTheme.headlineSmall?.copyWith(color: Colors.white),
        ),
        const SizedBox(height: 12),
        Text(
          mnemonic,
          textAlign: TextAlign.center,
          // Apply direct text style here
          style: const TextStyle(
            color: Colors.white,
            fontSize: 16, // Optional: Added for better readability
          ),
        ),
        const SizedBox(height: 24),
        ElevatedButton(
          onPressed: onConfirmed,
          child: const Text("I have backed it up"),
        ),
      ],
    );
  }
}
