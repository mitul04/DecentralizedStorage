import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_nav_bar/google_nav_bar.dart';
import 'screens/home_screen.dart';
import 'screens/upload_screen.dart';
import 'screens/files_screen.dart';

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
      home: const MainLayout(),
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
  const Center(child: Text("Profile")),
];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(child: _screens[_selectedIndex]),
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
              GButton(icon: Icons.person_rounded, text: 'Profile'),
            ],
          ),
        ),
      ),
    );
  }
}