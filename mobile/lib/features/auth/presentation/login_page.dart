import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../application/auth_controller.dart';

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({this.errorMessage, super.key});

  final String? errorMessage;

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _username = TextEditingController();
  final _password = TextEditingController();
  bool _obscurePassword = true;
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _username.addListener(_refresh);
    _password.addListener(_refresh);
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _username
      ..removeListener(_refresh)
      ..dispose();
    _password
      ..removeListener(_refresh)
      ..dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_isSubmitting || !_formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() => _isSubmitting = true);
    try {
      await ref
          .read(authControllerProvider.notifier)
          .signIn(username: _username.text, password: _password.text);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: LayoutBuilder(
        builder: (context, constraints) {
          final showHero = constraints.maxWidth >= 900;
          return Row(
            children: [
              if (showHero)
                const Expanded(flex: 104, child: _DesktopHeroPanel()),
              Expanded(
                flex: showHero ? 96 : 100,
                child: _LoginSurface(
                  showCompactBrand: !showHero,
                  child: _buildLoginCard(context, compact: !showHero),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildLoginCard(BuildContext context, {required bool compact}) {
    final theme = Theme.of(context);
    final canSubmit =
        _username.text.trim().isNotEmpty && _password.text.isNotEmpty;

    return TweenAnimationBuilder<double>(
      duration: const Duration(milliseconds: 520),
      curve: Curves.easeOutCubic,
      tween: Tween(begin: 0, end: 1),
      builder: (context, value, child) => Opacity(
        opacity: value,
        child: Transform.translate(
          offset: Offset(0, 18 * (1 - value)),
          child: child,
        ),
      ),
      child: Container(
        padding: const EdgeInsets.all(1.2),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(31),
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              Color(0xB38772FF),
              Color(0x8C21C7D5),
              Color(0x70FF9D5C),
              Color(0x809A84FF),
            ],
          ),
          boxShadow: const [
            BoxShadow(
              color: Color(0x1F28215E),
              blurRadius: 54,
              offset: Offset(0, 24),
            ),
            BoxShadow(
              color: Color(0x0D0F172A),
              blurRadius: 4,
              offset: Offset(0, 2),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(30),
          child: BackdropFilter(
            filter: ui.ImageFilter.blur(sigmaX: 18, sigmaY: 18),
            child: ColoredBox(
              color: Colors.white.withValues(alpha: 0.91),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Padding(
                    padding: EdgeInsets.fromLTRB(
                      compact ? 22 : 30,
                      compact ? 24 : 28,
                      compact ? 22 : 30,
                      21,
                    ),
                    child: Column(
                      children: [
                        _GradientIcon(
                          icon: compact
                              ? Icons.water_drop_rounded
                              : Icons.fingerprint_rounded,
                          vivid: compact,
                        ),
                        const SizedBox(height: 15),
                        Text(
                          'เข้าสู่ระบบพนักงาน',
                          textAlign: TextAlign.center,
                          style: theme.textTheme.headlineSmall?.copyWith(
                            color: const Color(0xFF16172B),
                            fontWeight: FontWeight.w900,
                            letterSpacing: -0.5,
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          'เข้าสู่ระบบด้วย Supabase Auth',
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: const Color(0xFF737386),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1, color: Color(0xFFEDEBF3)),
                  Padding(
                    padding: EdgeInsets.fromLTRB(
                      compact ? 22 : 30,
                      24,
                      compact ? 22 : 30,
                      27,
                    ),
                    child: Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const _FieldLabel('ชื่อผู้ใช้'),
                          const SizedBox(height: 8),
                          TextFormField(
                            controller: _username,
                            autofocus: !compact,
                            textInputAction: TextInputAction.next,
                            autocorrect: false,
                            enableSuggestions: false,
                            autofillHints: const [AutofillHints.username],
                            decoration: const InputDecoration(
                              hintText: 'เช่น admin',
                              prefixIcon: Icon(Icons.person_outline_rounded),
                            ),
                            validator: (value) =>
                                value == null || value.trim().isEmpty
                                ? 'กรุณากรอกชื่อผู้ใช้'
                                : null,
                          ),
                          const SizedBox(height: 18),
                          const _FieldLabel('รหัสผ่าน'),
                          const SizedBox(height: 8),
                          TextFormField(
                            controller: _password,
                            obscureText: _obscurePassword,
                            textInputAction: TextInputAction.done,
                            autocorrect: false,
                            enableSuggestions: false,
                            autofillHints: const [AutofillHints.password],
                            onFieldSubmitted: (_) => _submit(),
                            style: TextStyle(
                              letterSpacing: _obscurePassword ? 2.2 : 0,
                            ),
                            decoration: InputDecoration(
                              hintText: 'อย่างน้อย 10 ตัวอักษร',
                              prefixIcon: const Icon(Icons.key_rounded),
                              suffixIcon: IconButton(
                                tooltip: _obscurePassword
                                    ? 'แสดงรหัสผ่าน'
                                    : 'ซ่อนรหัสผ่าน',
                                onPressed: () => setState(
                                  () => _obscurePassword = !_obscurePassword,
                                ),
                                icon: Icon(
                                  _obscurePassword
                                      ? Icons.visibility_outlined
                                      : Icons.visibility_off_outlined,
                                ),
                              ),
                            ),
                            validator: (value) => value == null || value.isEmpty
                                ? 'กรุณากรอกรหัสผ่าน'
                                : null,
                          ),
                          if (widget.errorMessage != null) ...[
                            const SizedBox(height: 16),
                            _ErrorBox(message: widget.errorMessage!),
                          ],
                          const SizedBox(height: 22),
                          _GradientLoginButton(
                            enabled: canSubmit && !_isSubmitting,
                            loading: _isSubmitting,
                            onPressed: _submit,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _LoginSurface extends StatelessWidget {
  const _LoginSurface({required this.child, required this.showCompactBrand});

  final Widget child;
  final bool showCompactBrand;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: AppTheme.canvas,
      child: Stack(
        fit: StackFit.expand,
        children: [
          const CustomPaint(painter: _DotPatternPainter()),
          const Positioned(
            right: -90,
            top: -70,
            child: _AmbientOrb(color: Color(0x4431D8DF), size: 280),
          ),
          const Positioned(
            left: -110,
            bottom: -100,
            child: _AmbientOrb(color: Color(0x4B9478FF), size: 330),
          ),
          SafeArea(
            child: SingleChildScrollView(
              padding: EdgeInsets.symmetric(
                horizontal: showCompactBrand ? 18 : 32,
                vertical: 22,
              ),
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  minHeight:
                      MediaQuery.sizeOf(context).height -
                      MediaQuery.paddingOf(context).vertical -
                      44,
                ),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 440),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (showCompactBrand) ...[
                          const _CompactBrand(),
                          const SizedBox(height: 20),
                        ],
                        child,
                        const SizedBox(height: 18),
                        const _SecureConnectionLabel(),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CompactBrand extends StatelessWidget {
  const _CompactBrand();

  @override
  Widget build(BuildContext context) {
    return const Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _MiniBrandMark(),
        SizedBox(width: 11),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'PumpPOS',
              style: TextStyle(
                color: Color(0xFF191833),
                fontSize: 18,
                fontWeight: FontWeight.w900,
                letterSpacing: -0.4,
              ),
            ),
            Text(
              'SMART STATION OS',
              style: TextStyle(
                color: Color(0xFF6D6C85),
                fontSize: 8.5,
                letterSpacing: 1.65,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _DesktopHeroPanel extends StatelessWidget {
  const _DesktopHeroPanel();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF101028), Color(0xFF211B58), Color(0xFF104453)],
        ),
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          const CustomPaint(painter: _GridPatternPainter()),
          const Positioned(
            right: -120,
            top: 70,
            child: _AmbientOrb(color: Color(0x4D7554F2), size: 360),
          ),
          const Positioned(
            left: -90,
            bottom: -130,
            child: _AmbientOrb(color: Color(0x3822D3DC), size: 330),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(44),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _HeroBrand(),
                  Expanded(
                    child: LayoutBuilder(
                      builder: (context, constraints) => SingleChildScrollView(
                        child: ConstrainedBox(
                          constraints: BoxConstraints(
                            minHeight: constraints.maxHeight,
                          ),
                          child: Center(
                            child: ConstrainedBox(
                              constraints: const BoxConstraints(maxWidth: 560),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const _HeroBadge(),
                                  const SizedBox(height: 22),
                                  const Text(
                                    'งานหน้าปั๊ม\nคุมทุกจังหวะในหน้าจอเดียว',
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: 43,
                                      height: 1.2,
                                      fontWeight: FontWeight.w900,
                                      letterSpacing: -1.6,
                                    ),
                                  ),
                                  const SizedBox(height: 18),
                                  const Text(
                                    'ขายสินค้า ตัดกะ เช็กสต๊อก และติดตามยอดได้รวดเร็ว\nออกแบบเพื่อการทำงานต่อเนื่องของสถานีบริการ',
                                    style: TextStyle(
                                      color: Color(0x99FFFFFF),
                                      height: 1.7,
                                      fontSize: 16,
                                    ),
                                  ),
                                  const SizedBox(height: 30),
                                  const Row(
                                    children: [
                                      Expanded(
                                        child: _HeroFeature(
                                          icon: Icons.speed_rounded,
                                          label: 'ทำรายการเร็ว',
                                        ),
                                      ),
                                      SizedBox(width: 12),
                                      Expanded(
                                        child: _HeroFeature(
                                          icon: Icons.verified_user_outlined,
                                          label: 'ข้อมูลเป็นระบบ',
                                        ),
                                      ),
                                      SizedBox(width: 12),
                                      Expanded(
                                        child: _HeroFeature(
                                          icon: Icons.wifi_rounded,
                                          label: 'รองรับหลายจุด',
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 15),
                                  const _SystemStatusCard(),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const Row(
                    children: [
                      _StatusDot(),
                      SizedBox(width: 9),
                      Text(
                        'ระบบจัดการสถานีบริการแบบครบวงจร',
                        style: TextStyle(color: Color(0x66FFFFFF)),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _GradientIcon extends StatelessWidget {
  const _GradientIcon({required this.icon, required this.vivid});

  final IconData icon;
  final bool vivid;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: vivid ? 58 : 50,
      height: vivid ? 58 : 50,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        gradient: vivid
            ? const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF8B5CF6), Color(0xFF22C7D5)],
              )
            : const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFFF0ECFF), Color(0xFFE9FBFC)],
              ),
        boxShadow: vivid
            ? const [
                BoxShadow(
                  color: Color(0x356656E8),
                  blurRadius: 22,
                  offset: Offset(0, 9),
                ),
              ]
            : null,
      ),
      child: Icon(
        icon,
        size: vivid ? 28 : 25,
        color: vivid ? Colors.white : const Color(0xFF5E4EC9),
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        color: Color(0xFF3D4054),
        fontSize: 14,
        fontWeight: FontWeight.w700,
      ),
    );
  }
}

class _GradientLoginButton extends StatelessWidget {
  const _GradientLoginButton({
    required this.enabled,
    required this.loading,
    required this.onPressed,
  });

  final bool enabled;
  final bool loading;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return AnimatedOpacity(
      duration: const Duration(milliseconds: 180),
      opacity: enabled || loading ? 1 : 0.48,
      child: Container(
        height: 54,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          gradient: const LinearGradient(
            colors: [Color(0xFF7457F0), Color(0xFF5D55DF), Color(0xFF20B9CC)],
          ),
          boxShadow: const [
            BoxShadow(
              color: Color(0x396656E8),
              blurRadius: 24,
              offset: Offset(0, 11),
            ),
          ],
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: enabled ? onPressed : null,
            borderRadius: BorderRadius.circular(18),
            child: Center(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 180),
                child: loading
                    ? const SizedBox(
                        key: ValueKey('loading'),
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.6,
                          color: Colors.white,
                        ),
                      )
                    : const Row(
                        key: ValueKey('label'),
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.login_rounded,
                            color: Colors.white,
                            size: 20,
                          ),
                          SizedBox(width: 9),
                          Text(
                            'เข้าสู่ระบบ',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 16,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ErrorBox extends StatelessWidget {
  const _ErrorBox({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF3F2),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: const Color(0xFFFFD1CC)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: const BoxDecoration(
              color: Color(0xFFFFE3E0),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.error_outline_rounded,
              color: Color(0xFFC3322A),
              size: 18,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(top: 3),
              child: Text(
                message,
                style: const TextStyle(
                  color: Color(0xFF9D2C28),
                  height: 1.45,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SecureConnectionLabel extends StatelessWidget {
  const _SecureConnectionLabel();

  @override
  Widget build(BuildContext context) {
    return const Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(Icons.lock_outline_rounded, size: 15, color: Color(0xFF7D7B91)),
        SizedBox(width: 7),
        Flexible(
          child: Text(
            'เชื่อมต่ออย่างปลอดภัยผ่าน Supabase Auth',
            textAlign: TextAlign.center,
            style: TextStyle(color: Color(0xFF77758B), fontSize: 12),
          ),
        ),
      ],
    );
  }
}

class _MiniBrandMark extends StatelessWidget {
  const _MiniBrandMark();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 42,
      height: 42,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF67DDE2), Color(0xFF7554F2), Color(0xFF4C45C5)],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x306656E8),
            blurRadius: 18,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: const Icon(
        Icons.water_drop_rounded,
        color: Colors.white,
        size: 21,
      ),
    );
  }
}

class _HeroBrand extends StatelessWidget {
  const _HeroBrand();

  @override
  Widget build(BuildContext context) {
    return const Row(
      children: [
        _MiniBrandMark(),
        SizedBox(width: 12),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'PumpPOS',
              style: TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.w900,
              ),
            ),
            Text(
              'SMART STATION OS',
              style: TextStyle(
                color: Color(0x999AEAF0),
                fontSize: 9,
                letterSpacing: 1.8,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _HeroBadge extends StatelessWidget {
  const _HeroBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0x1422D3EE),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: const Color(0x3322D3EE)),
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _StatusDot(color: Color(0xFF67E8F9)),
          SizedBox(width: 9),
          Text(
            'NEXT GENERATION POS',
            style: TextStyle(
              color: Color(0xFFB8F7FC),
              fontSize: 10,
              letterSpacing: 1.6,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroFeature extends StatelessWidget {
  const _HeroFeature({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: const Color(0x0FFFFFFF),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0x1AFFFFFF)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: const Color(0xFF67E8F9), size: 21),
          const SizedBox(height: 11),
          Text(
            label,
            style: const TextStyle(color: Color(0xC7FFFFFF), fontSize: 12),
          ),
        ],
      ),
    );
  }
}

class _SystemStatusCard extends StatelessWidget {
  const _SystemStatusCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: const Color(0x5C090820),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0x1FFFFFFF)),
      ),
      child: Column(
        children: [
          const Row(
            children: [
              Icon(
                Icons.monitor_heart_outlined,
                color: Color(0xFF67E8F9),
                size: 18,
              ),
              SizedBox(width: 8),
              Text(
                'สถานะการทำงาน',
                style: TextStyle(
                  color: Color(0xD9FFFFFF),
                  fontWeight: FontWeight.w700,
                ),
              ),
              Spacer(),
              _StatusDot(),
              SizedBox(width: 7),
              Text(
                'พร้อมใช้งาน',
                style: TextStyle(color: Color(0xFF6EE7B7), fontSize: 11),
              ),
            ],
          ),
          const SizedBox(height: 15),
          const Row(
            children: [
              Expanded(
                child: _StatusMetric(
                  label: 'งานขาย',
                  value: 'รวดเร็ว',
                  progress: .88,
                ),
              ),
              SizedBox(width: 10),
              Expanded(
                child: _StatusMetric(
                  label: 'สต๊อก',
                  value: 'แม่นยำ',
                  progress: .76,
                ),
              ),
              SizedBox(width: 10),
              Expanded(
                child: _StatusMetric(
                  label: 'รายงาน',
                  value: 'ครบถ้วน',
                  progress: .94,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StatusMetric extends StatelessWidget {
  const _StatusMetric({
    required this.label,
    required this.value,
    required this.progress,
  });

  final String label;
  final String value;
  final double progress;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: const Color(0x0DFFFFFF),
        borderRadius: BorderRadius.circular(13),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(color: Color(0x70FFFFFF), fontSize: 10),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(
              color: Color(0xD4FFFFFF),
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(9),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 4,
              backgroundColor: const Color(0x1FFFFFFF),
              valueColor: const AlwaysStoppedAnimation(Color(0xFF6DD9E5)),
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusDot extends StatelessWidget {
  const _StatusDot({this.color = const Color(0xFF34D399)});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 7,
      height: 7,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

class _AmbientOrb extends StatelessWidget {
  const _AmbientOrb({required this.color, required this.size});

  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    return ImageFiltered(
      imageFilter: ui.ImageFilter.blur(sigmaX: 54, sigmaY: 54),
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      ),
    );
  }
}

class _DotPatternPainter extends CustomPainter {
  const _DotPatternPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = const Color(0x176656E8);
    for (double x = 9; x < size.width; x += 18) {
      for (double y = 9; y < size.height; y += 18) {
        canvas.drawCircle(Offset(x, y), 0.8, paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _GridPatternPainter extends CustomPainter {
  const _GridPatternPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0x0AFFFFFF)
      ..strokeWidth = 1;
    for (double x = 0; x < size.width; x += 32) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (double y = 0; y < size.height; y += 32) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
