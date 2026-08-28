import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../data/operations_repository.dart';

final operationsRepositoryProvider = Provider<OperationsRepository>(
  (ref) => OperationsRepository(ref.watch(trpcClientProvider)),
);
