import 'package:flutter/material.dart';

class AppPageHero extends StatelessWidget {
  const AppPageHero({
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.icon,
    this.status,
    this.statusColor = const Color(0xFF67E8F9),
    this.child,
    super.key,
  });

  final String eyebrow;
  final String title;
  final String subtitle;
  final IconData icon;
  final String? status;
  final Color statusColor;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(26),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF151333), Color(0xFF25205D), Color(0xFF124554)],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x33211B58),
            blurRadius: 34,
            offset: Offset(0, 16),
          ),
        ],
      ),
      child: Stack(
        children: [
          const Positioned(
            right: -56,
            top: -76,
            child: _HeroGlow(color: Color(0x407C5CFC), size: 190),
          ),
          const Positioned(
            left: -62,
            bottom: -90,
            child: _HeroGlow(color: Color(0x301ED4D9), size: 170),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(16),
                        gradient: const LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [Color(0xFF8B5CF6), Color(0xFF22C7D5)],
                        ),
                        border: Border.all(color: const Color(0x3DFFFFFF)),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0x3D000000),
                            blurRadius: 18,
                            offset: Offset(0, 8),
                          ),
                        ],
                      ),
                      child: Icon(icon, color: Colors.white, size: 24),
                    ),
                    const SizedBox(width: 13),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            eyebrow.toUpperCase(),
                            style: const TextStyle(
                              color: Color(0xFF8BE8EF),
                              fontSize: 9.5,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 1.45,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            title,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 22,
                              height: 1.2,
                              fontWeight: FontWeight.w900,
                              letterSpacing: -0.5,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            subtitle,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Color(0x99FFFFFF),
                              fontSize: 12.5,
                              height: 1.45,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (status != null) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 7,
                        ),
                        decoration: BoxDecoration(
                          color: statusColor.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(99),
                          border: Border.all(
                            color: statusColor.withValues(alpha: 0.25),
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              width: 7,
                              height: 7,
                              decoration: BoxDecoration(
                                color: statusColor,
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Text(
                              status!,
                              style: TextStyle(
                                color: statusColor,
                                fontSize: 10.5,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
                if (child != null) ...[
                  const SizedBox(height: 18),
                  Container(height: 1, color: const Color(0x1FFFFFFF)),
                  const SizedBox(height: 16),
                  child!,
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class AppHeroStat extends StatelessWidget {
  const AppHeroStat({required this.label, required this.value, super.key});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0x12FFFFFF),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0x12FFFFFF)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: Color(0x70FFFFFF), fontSize: 10.5),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 15,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroGlow extends StatelessWidget {
  const _HeroGlow({required this.color, required this.size});

  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(colors: [color, Colors.transparent]),
      ),
    );
  }
}
