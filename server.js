const express = require('express');
const cors = require('cors');
const http = require('http');
require('dotenv').config(); // Carrega variáveis de ambiente
const whatsappController = require('./controllers/whatsappController');
const authMiddleware = require('./middleware/auth');
const websocketService = require('./services/websocketService');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Inicializar WebSocket
websocketService.initialize(server);

// Rota pública para verificar se o servidor está rodando
app.get('/', (req, res) => {
  const wsStats = websocketService.getConnectionStats();
  
  res.json({ 
    message: 'Servidor WhatsApp MultiCliente rodando!',
    version: '1.3.0',
    authentication: 'Token obrigatório para acessar as rotas da API',
    websocket: {
      enabled: true,
      url: `ws://localhost:${PORT}`,
      connections: wsStats.totalConnections,
      authenticated: wsStats.authenticatedConnections
    },
    endpoints: {
      // Endpoints de cliente
      'POST /client/create?token=SEU_TOKEN': 'Criar novo cliente',
      'GET /client/:clientId/qr?token=SEU_TOKEN': 'Obter QR Code',
      'GET /client/:clientId/qr/stats?token=SEU_TOKEN': 'Estatísticas do QR Code',
      'GET /client/:clientId/status?token=SEU_TOKEN': 'Status do cliente',
      'POST /client/:clientId/send?token=SEU_TOKEN': 'Enviar mensagem',
      'DELETE /client/:clientId?token=SEU_TOKEN': 'Remover cliente',
      'GET /clients?token=SEU_TOKEN': 'Listar todos os clientes',
      
      // Endpoints de mensagens
      'GET /client/:clientId/messages?token=SEU_TOKEN': 'Listar mensagens recebidas',
      'GET /client/:clientId/messages/latest?token=SEU_TOKEN': 'Últimas mensagens',
      'GET /client/:clientId/messages/search?token=SEU_TOKEN': 'Buscar mensagens',
      'GET /client/:clientId/messages/stats?token=SEU_TOKEN': 'Estatísticas de mensagens',
      'DELETE /client/:clientId/messages?token=SEU_TOKEN': 'Limpar mensagens'
    },
    websocket_events: {
      'authenticate': 'Autenticar com token',
      'subscribe': 'Inscrever-se em um cliente',
      'unsubscribe': 'Cancelar inscrição',
      'list_clients': 'Listar clientes disponíveis',
      'new_message': 'Evento: Nova mensagem recebida',
      'client_status_change': 'Evento: Mudança de status',
      'qr_code': 'Evento: Novo QR Code'
    },
    note: 'Substitua SEU_TOKEN pelo token configurado na variável ACCESS_TOKEN'
  });
});

// Rotas de cliente (existentes)
app.post('/client/create', authMiddleware, whatsappController.createClient);
app.get('/client/:clientId/qr', authMiddleware, whatsappController.getQRCode);
app.get('/client/:clientId/qr/stats', authMiddleware, whatsappController.getQRStats);
app.get('/client/:clientId/status', authMiddleware, whatsappController.getStatus);
app.post('/client/:clientId/send', authMiddleware, whatsappController.sendMessage);
app.delete('/client/:clientId', authMiddleware, whatsappController.removeClient);
app.get('/clients', authMiddleware, whatsappController.listClients);

// Rotas para mensagens recebidas
app.get('/client/:clientId/messages', authMiddleware, whatsappController.getMessages);
app.get('/client/:clientId/messages/latest', authMiddleware, whatsappController.getLatestMessages);
app.get('/client/:clientId/messages/search', authMiddleware, whatsappController.searchMessages);
app.get('/client/:clientId/messages/stats', authMiddleware, whatsappController.getMessageStats);
app.delete('/client/:clientId/messages', authMiddleware, whatsappController.clearMessages);

// Nova rota para estatísticas do WebSocket
app.get('/websocket/stats', authMiddleware, (req, res) => {
  const stats = websocketService.getConnectionStats();
  res.json(stats);
});

server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🌐 WebSocket disponível em: ws://localhost:${PORT}`);
  
  // Aviso sobre configuração do token
  if (!process.env.ACCESS_TOKEN) {
    console.warn('⚠️  AVISO: ACCESS_TOKEN não configurado!');
    console.warn('   Configure a variável de ambiente ACCESS_TOKEN para maior segurança.');
    console.warn('   Exemplo: ACCESS_TOKEN=meu_token_secreto npm start');
  } else {
    console.log('🔒 Autenticação por token ativada');
  }
  
  console.log('📨 Sistema de mensagens recebidas ativo');
  console.log('🔌 WebSocket em tempo real ativo');
});

process.on('SIGINT', async () => {
  console.log('\n🔄 Encerrando servidor...');
  const whatsappService = require('./services/whatsappService');
  await whatsappService.destroyAllClients();
  process.exit(0);
});