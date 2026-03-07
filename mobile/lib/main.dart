import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_nav_bar/google_nav_bar.dart';
import 'screens/home_screen.dart';
import 'screens/upload_screen.dart';
import 'screens/files_screen.dart';
import 'screens/rewards_screen.dart';
import 'screens/wallet/wallet_gate_screen.dart';

void main() {
  runApp(const DecloudApp());
}

class DecloudApp extends StatelessWidget {
  const DecloudApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        textTheme: GoogleFonts.poppinsTextTheme(),
        scaffoldBackgroundColor: const Color(0xFFF8F9FE),
        useMaterial3: true,
      ),
      home: const WalletGateScreen(),
    );
  }
}

class MainLayout extends StatefulWidget {
  const MainLayout({super.key});

  @override
  State<MainLayout> createState() => _MainLayoutState();
}

class _MainLayoutState extends State<MainLayout> {
  int _selectedIndex = 0;
  
  final List<Widget> _screens = [
  const HomeScreen(),
  const UploadScreen(),
  const FilesScreen(),
  const RewardsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        // 🔄 HYBRID STACK: Combines persistence with auto-refresh
        child: Stack(
          children: [
            // 1. Persistent Upload Screen
            // It is ALWAYS in the widget tree, just hidden when not in use.
            // This prevents the "State" from being destroyed during uploads.
            Offstage(
              offstage: _selectedIndex != 1, // Only visible when Index is 1
              child: const UploadScreen(),
            ),

            // 2. Auto-Refreshing Screens (Home, Files, Rewards)
            // These are created brand new every time you switch to them.
            // This triggers 'initState', causing them to fetch fresh data instantly.
            if (_selectedIndex != 1) 
              _screens[_selectedIndex],
          ],
        ),
      ),
      bottomNavigationBar: Container(
        color: Colors.white,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 15.0, vertical: 20),
          child: GNav(
            gap: 8,
            backgroundColor: Colors.white,
            color: Colors.grey,
            activeColor: const Color(0xFF6C63FF),
            tabBackgroundColor: const Color(0xFF6C63FF).withOpacity(0.1),
            padding: const EdgeInsets.all(16),
            onTabChange: (index) => setState(() => _selectedIndex = index),
            tabs: const [
              GButton(icon: Icons.home_rounded, text: 'Home'),
              GButton(icon: Icons.cloud_upload_rounded, text: 'Upload'),
              GButton(icon: Icons.folder_open_rounded, text: 'Files'),
              GButton(icon: Icons.savings_rounded, text: 'Rewards'),
            ],
          ),
        ),
      ),
    );
  }
}