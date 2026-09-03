import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../config/app_config.dart';
import '../providers/auth_provider.dart';
import '../providers/dashboard_provider.dart';
import '../utils/responsive.dart';
import '../widgets/connection_banner.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  bool _isRegisterMode = false;

  // Controllers
  final _nameController = TextEditingController();
  final _emailController = TextEditingController(text: 'sabithacys@siet.ac');
  final _passwordController = TextEditingController(text: 'admin123');
  final _roomController = TextEditingController(text: '101');
  final _blockController = TextEditingController(text: 'Block A');

  String _selectedRole = 'admin';
  bool _obscurePassword = true;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _roomController.dispose();
    _blockController.dispose();
    super.dispose();
  }

  Future<void> _handleSubmit() async {
    if (!_formKey.currentState!.validate()) return;

    final authProvider = Provider.of<AuthProvider>(context, listen: false);

    bool success = false;
    if (_isRegisterMode) {
      success = await authProvider.register(
        name: _nameController.text.trim(),
        email: _emailController.text.trim(),
        password: _passwordController.text,
        role: _selectedRole,
        roomNumber: _roomController.text.trim(),
        hostelBlock: _blockController.text.trim(),
      );
    } else {
      success = await authProvider.login(
        _emailController.text.trim(),
        _passwordController.text,
        _selectedRole,
      );
    }

    if (!mounted) return;
    if (success) {
      Navigator.of(context).pushReplacementNamed('/main');
    }
  }

  void _handleDemoAccess() {
    final authProvider = Provider.of<AuthProvider>(context, listen: false);
    authProvider.setDemoUser();
    Navigator.of(context).pushReplacementNamed('/main');
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final authProvider = Provider.of<AuthProvider>(context);
    final dashboardProvider = Provider.of<DashboardProvider>(context);
    final double px = AppResponsive.paddingHorizontal(context);

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            ConnectionBanner(
              status: dashboardProvider.connectionStatus,
              onRetry: () => dashboardProvider.refreshDashboard(),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: EdgeInsets.symmetric(horizontal: px, vertical: 16.0),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const SizedBox(height: 12),
                      Center(
                        child: Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: theme.colorScheme.primary.withValues(alpha: 0.12),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            _isRegisterMode ? Icons.person_add_rounded : Icons.admin_panel_settings_rounded,
                            size: 44,
                            color: theme.colorScheme.primary,
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        _isRegisterMode ? 'Create Account' : 'Sign In',
                        style: theme.textTheme.headlineMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _isRegisterMode
                            ? 'Register new Student, Warden or Security profile'
                            : 'Smart Surveillance System Access',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontSize: 13,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 20),

                      // Sign In / Register Mode Selector
                      Container(
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.surfaceContainerHighest,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: ChoiceChip(
                                label: const Center(child: Text('Sign In', style: TextStyle(fontWeight: FontWeight.bold))),
                                selected: !_isRegisterMode,
                                onSelected: (val) {
                                  if (val) setState(() => _isRegisterMode = false);
                                },
                              ),
                            ),
                            Expanded(
                              child: ChoiceChip(
                                label: const Center(child: Text('Register', style: TextStyle(fontWeight: FontWeight.bold))),
                                selected: _isRegisterMode,
                                onSelected: (val) {
                                  if (val) setState(() => _isRegisterMode = true);
                                },
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 20),

                      if (authProvider.errorMessage != null) ...[
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: Colors.red.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: Colors.red.withValues(alpha: 0.3)),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.error_outline, color: Colors.red, size: 20),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  authProvider.errorMessage!,
                                  style: const TextStyle(color: Colors.red, fontSize: 12),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],

                      // Role Segmented Control
                      Text(
                        'Select Role',
                        style: theme.textTheme.labelMedium?.copyWith(fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 8),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        child: SegmentedButton<String>(
                          segments: const [
                            ButtonSegment(value: 'student', label: Text('Student'), icon: Icon(Icons.school_outlined, size: 18)),
                            ButtonSegment(value: 'admin', label: Text('Admin'), icon: Icon(Icons.shield_outlined, size: 18)),
                            ButtonSegment(value: 'warden', label: Text('Warden'), icon: Icon(Icons.security_outlined, size: 18)),
                            ButtonSegment(value: 'security', label: Text('Security'), icon: Icon(Icons.badge_outlined, size: 18)),
                          ],
                          selected: {_selectedRole},
                          onSelectionChanged: (Set<String> newSelection) {
                            setState(() {
                              _selectedRole = newSelection.first;
                              if (_selectedRole == 'admin' && !_isRegisterMode) {
                                _emailController.text = 'sabithacys@siet.ac';
                                _passwordController.text = 'admin123';
                              }
                            });
                          },
                        ),
                      ),
                      const SizedBox(height: 16),

                      // Full Name (Only for Registration)
                      if (_isRegisterMode) ...[
                        TextFormField(
                          controller: _nameController,
                          decoration: InputDecoration(
                            labelText: 'Full Name',
                            prefixIcon: const Icon(Icons.person_outline_rounded),
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                          ),
                          validator: (value) {
                            if (_isRegisterMode && (value == null || value.trim().isEmpty)) {
                              return 'Please enter your name';
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: 14),
                      ],

                      // Email Field
                      TextFormField(
                        controller: _emailController,
                        keyboardType: TextInputType.emailAddress,
                        decoration: InputDecoration(
                          labelText: 'Email Address',
                          prefixIcon: const Icon(Icons.email_outlined),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
                          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return 'Please enter email address';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 14),

                      // Password Field
                      TextFormField(
                        controller: _passwordController,
                        obscureText: _obscurePassword,
                        decoration: InputDecoration(
                          labelText: 'Password',
                          prefixIcon: const Icon(Icons.lock_outline_rounded),
                          suffixIcon: IconButton(
                            icon: Icon(_obscurePassword ? Icons.visibility_off_outlined : Icons.visibility_outlined),
                            onPressed: () {
                              setState(() {
                                _obscurePassword = !_obscurePassword;
                              });
                            },
                          ),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
                          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                        ),
                        validator: (value) {
                          if (value == null || value.isEmpty) {
                            return 'Please enter password';
                          }
                          return null;
                        },
                      ),

                      // Additional details for Registration
                      if (_isRegisterMode && _selectedRole == 'student') ...[
                        const SizedBox(height: 14),
                        Row(
                          children: [
                            Expanded(
                              child: TextFormField(
                                controller: _blockController,
                                decoration: InputDecoration(
                                  labelText: 'Hostel Block',
                                  prefixIcon: const Icon(Icons.apartment_rounded),
                                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: TextFormField(
                                controller: _roomController,
                                decoration: InputDecoration(
                                  labelText: 'Room No.',
                                  prefixIcon: const Icon(Icons.meeting_room_outlined),
                                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],

                      const SizedBox(height: 20),

                      // Submit Button
                      SizedBox(
                        height: AppResponsive.minTouchTarget,
                        child: FilledButton(
                          onPressed: authProvider.isLoading ? null : _handleSubmit,
                          style: FilledButton.styleFrom(
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          ),
                          child: authProvider.isLoading
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                )
                              : Text(
                                  _isRegisterMode ? 'Register Account' : 'Sign In to System',
                                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                                ),
                        ),
                      ),

                      const SizedBox(height: 14),

                      // Quick Demo Access Button
                      OutlinedButton.icon(
                        onPressed: _handleDemoAccess,
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        ),
                        icon: const Icon(Icons.flash_on_rounded, color: Colors.amber),
                        label: const Text(
                          'Instant Access (Demo Mode)',
                          style: TextStyle(fontWeight: FontWeight.bold),
                        ),
                      ),

                      const SizedBox(height: 16),
                      Center(
                        child: Text(
                          'Backend: ${AppConfig.baseUrl}',
                          style: theme.textTheme.bodySmall?.copyWith(fontSize: 10),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
