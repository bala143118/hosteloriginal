import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../config/app_config.dart';

class SocketService {
  io.Socket? _socket;
  final StreamController<Map<String, dynamic>> _alertStreamController = StreamController<Map<String, dynamic>>.broadcast();
  final StreamController<bool> _connectionStreamController = StreamController<bool>.broadcast();

  Stream<Map<String, dynamic>> get alertStream => _alertStreamController.stream;
  Stream<bool> get connectionStream => _connectionStreamController.stream;

  bool get isConnected => _socket?.connected ?? false;

  void initSocket() {
    if (_socket != null && _socket!.connected) return;

    try {
      _socket = io.io(
        AppConfig.baseUrl,
        io.OptionBuilder()
            .setTransports(['websocket', 'polling'])
            .disableAutoConnect()
            .enableReconnection()
            .setReconnectionAttempts(10)
            .setReconnectionDelay(2000)
            .build(),
      );

      _socket?.onConnect((_) {
        _connectionStreamController.add(true);
      });

      _socket?.onDisconnect((_) {
        _connectionStreamController.add(false);
      });

      _socket?.onConnectError((err) {
        _connectionStreamController.add(false);
      });

      // Real-time Event listeners
      _socket?.on('security-event-created', (data) {
        if (data is Map<String, dynamic>) {
          _alertStreamController.add(data);
        }
      });

      _socket?.on('alert.created', (data) {
        if (data is Map<String, dynamic>) {
          _alertStreamController.add(data);
        }
      });

      _socket?.connect();
    } catch (_) {
      _connectionStreamController.add(false);
    }
  }

  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
  }

  void dispose() {
    disconnect();
    _alertStreamController.close();
    _connectionStreamController.close();
  }
}
