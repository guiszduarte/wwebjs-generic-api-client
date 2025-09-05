const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs-extra');
const path = require('path');

class WhatsAppService {
  constructor() {
    this.clients = new Map();
    this.clientStatus = new Map();
    this.qrCodes = new Map();
    this.receivedMessages = new Map(); // Armazena mensagens recebidas por cliente
    this.websocketService = null; // Será inicializado quando necessário
  }

  // Método para obter o serviço WebSocket (lazy loading)
  getWebSocketService() {
    if (!this.websocketService) {
      this.websocketService = require('./websocketService');
    }
    return this.websocketService;
  }

  async createClient(clientId) {
    if (this.clients.has(clientId)) {
      throw new Error(`Cliente ${clientId} já existe`);
    }

    // Inicializar array de mensagens para o cliente
    this.receivedMessages.set(clientId, []);

    const client = new Client({
      authStrategy: new LocalAuth({ clientId }),
      puppeteer: { headless: true }
    });

    client.on('qr', async (qr) => {
      try {
        // Verificar se é um QR code diferente do anterior para evitar spam
        const qrHash = require('crypto').createHash('md5').update(qr).digest('hex');
        const lastHash = this.lastQRHashes.get(clientId);
        const lastGeneration = this.qrGenerationTimestamps.get(clientId) || 0;
        const now = Date.now();

        // Se é o mesmo QR code e foi gerado há menos de 5 segundos, ignorar
        if (lastHash === qrHash && (now - lastGeneration) < 5000) {
          return;
        }

        const qrCodeDataURL = await qrcode.toDataURL(qr);
        const qrData = { qr, qrCodeDataURL, timestamp: new Date() };

        this.qrCodes.set(clientId, qrData);
        this.lastQRHashes.set(clientId, qrHash);
        this.qrGenerationTimestamps.set(clientId, now);

        // Verificar se o status mudou para evitar logs desnecessários
        const currentStatus = this.clientStatus.get(clientId);
        if (currentStatus !== 'qr_generated') {
          console.log(`📱 QR Code gerado para cliente: ${clientId}`);
          this.clientStatus.set(clientId, 'qr_generated');

          // Emitir mudança de status via WebSocket apenas se mudou
          this.getWebSocketService().emitStatusChange(clientId, 'qr_generated');
        } else {
          console.log(`🔄 QR Code atualizado para cliente: ${clientId} (expiração automática)`);
        }

        // Sempre emitir o QR Code atualizado via WebSocket
        this.getWebSocketService().emitQRCode(clientId, qrData);

      } catch (error) {
        console.error(`Erro ao processar QR code para cliente ${clientId}:`, error.message);
      }
    });

    client.on('ready', () => {
      const previousStatus = this.clientStatus.get(clientId);
      this.clientStatus.set(clientId, 'ready');
      this.qrCodes.delete(clientId);
      // Limpar dados de controle de QR
      this.lastQRHashes.delete(clientId);
      this.qrGenerationTimestamps.delete(clientId);

      if (previousStatus !== 'ready') {
        console.log(`✅ Cliente ${clientId} pronto!`);
        // Emitir mudança de status via WebSocket
        this.getWebSocketService().emitStatusChange(clientId, 'ready');
      }
    });

    client.on('authenticated', () => {
      const previousStatus = this.clientStatus.get(clientId);
      this.clientStatus.set(clientId, 'authenticated');

      if (previousStatus !== 'authenticated') {
        console.log(`🔐 Cliente ${clientId} autenticado`);
        // Emitir mudança de status via WebSocket
        this.getWebSocketService().emitStatusChange(clientId, 'authenticated');
      }
    });

    client.on('auth_failure', () => {
      const previousStatus = this.clientStatus.get(clientId);
      this.clientStatus.set(clientId, 'auth_failure');

      if (previousStatus !== 'auth_failure') {
        console.log(`❌ Falha na autenticação do cliente ${clientId}`);
        // Emitir mudança de status via WebSocket
        this.getWebSocketService().emitStatusChange(clientId, 'auth_failure');
      }
    });

    client.on('disconnected', () => {
      const previousStatus = this.clientStatus.get(clientId);
      this.clientStatus.set(clientId, 'disconnected');

      if (previousStatus !== 'disconnected') {
        console.log(`🔌 Cliente ${clientId} desconectado`);
        // Emitir mudança de status via WebSocket
        this.getWebSocketService().emitStatusChange(clientId, 'disconnected');
      }
    });

    client.on('message', async (msg) => {
      console.log(`📨 [${clientId}] ${msg.from}: ${msg.body}`);
      
      // Obter informações detalhadas do contato
      let contactInfo = {};
      try {
        const contact = await msg.getContact();
        contactInfo = {
          id: contact.id._serialized,
          name: contact.name || contact.pushname || 'Sem nome',
          pushname: contact.pushname,
          shortName: contact.shortName,
          number: contact.number,
          isMyContact: contact.isMyContact,
          isUser: contact.isUser,
          isGroup: contact.isGroup,
          isWAContact: contact.isWAContact,
          profilePicUrl: null // Será obtido separadamente se necessário
        };

        // Tentar obter foto do perfil (pode falhar)
        try {
          contactInfo.profilePicUrl = await contact.getProfilePicUrl();
        } catch (error) {
          // Foto do perfil não disponível
          contactInfo.profilePicUrl = null;
        }
      } catch (error) {
        console.warn(`Erro ao obter informações do contato: ${error.message}`);
        // Fallback para informações básicas
        contactInfo = {
          id: msg.from,
          name: msg._data.notifyName || msg.from,
          number: msg.from.replace('@c.us', '').replace('@g.us', ''),
          isGroup: msg.from.includes('@g.us')
        };
      }

      // Obter informações do chat se for grupo
      let chatInfo = {};
      if (msg.from.includes('@g.us')) {
        try {
          const chat = await msg.getChat();
          chatInfo = {
            id: chat.id._serialized,
            name: chat.name,
            isGroup: chat.isGroup,
            participantsCount: chat.participants ? chat.participants.length : 0,
            description: chat.description || null,
            createdAt: chat.createdAt ? new Date(chat.createdAt * 1000) : null
          };
        } catch (error) {
          console.warn(`Erro ao obter informações do chat: ${error.message}`);
        }
      }
      
      // Armazenar mensagem recebida com informações completas
      const messageData = {
        id: msg.id._serialized,
        from: msg.from,
        to: msg.to,
        body: msg.body,
        type: msg.type,
        timestamp: new Date(msg.timestamp * 1000),
        isGroup: msg.from.includes('@g.us'),
        hasMedia: msg.hasMedia,
        receivedAt: new Date(),
        
        // Informações detalhadas do contato
        contact: contactInfo,
        
        // Informações do chat (se for grupo)
        chat: msg.from.includes('@g.us') ? chatInfo : null,
        
        // Informações adicionais da mensagem
        isForwarded: msg.isForwarded,
        forwardingScore: msg.forwardingScore || 0,
        isStatus: msg.isStatus,
        isStarred: msg.isStarred,
        broadcast: msg.broadcast,
        fromMe: msg.fromMe,
        deviceType: msg.deviceType,
        
        // Informações de localização (se aplicável)
        location: null,
        
        // Informações de citação (se aplicável)
        hasQuotedMsg: msg.hasQuotedMsg,
        quotedMsg: null
      };

      // Adicionar informações de mídia se existir
      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          messageData.media = {
            mimetype: media.mimetype,
            filename: media.filename,
            data: media.data, // Base64
            size: media.data ? Buffer.from(media.data, 'base64').length : 0
          };
        } catch (error) {
          console.error(`Erro ao baixar mídia: ${error.message}`);
          messageData.mediaError = error.message;
        }
      }

      // Adicionar informações de localização se for mensagem de localização
      if (msg.type === 'location' && msg.location) {
        messageData.location = {
          latitude: msg.location.latitude,
          longitude: msg.location.longitude,
          description: msg.location.description || null
        };
      }

      // Adicionar mensagem citada se existir
      if (msg.hasQuotedMsg) {
        try {
          const quotedMsg = await msg.getQuotedMessage();
          messageData.quotedMsg = {
            id: quotedMsg.id._serialized,
            body: quotedMsg.body,
            from: quotedMsg.from,
            type: quotedMsg.type,
            timestamp: new Date(quotedMsg.timestamp * 1000)
          };
        } catch (error) {
          console.warn(`Erro ao obter mensagem citada: ${error.message}`);
        }
      }

      // Adicionar à lista de mensagens do cliente
      const clientMessages = this.receivedMessages.get(clientId) || [];
      clientMessages.push(messageData);
      
      // Manter apenas as últimas 1000 mensagens por cliente para evitar uso excessivo de memória
      if (clientMessages.length > 1000) {
        clientMessages.shift();
      }
      
      this.receivedMessages.set(clientId, clientMessages);

      // Emitir nova mensagem via WebSocket
      this.getWebSocketService().emitNewMessage(clientId, messageData);
    });

    this.clients.set(clientId, client);
    this.clientStatus.set(clientId, 'initializing');
    
    // Emitir mudança de status via WebSocket
    this.getWebSocketService().emitStatusChange(clientId, 'initializing');
    
    await client.initialize();
    return { success: true, message: `Cliente ${clientId} criado` };
  }

  getQRCode(clientId) {
    if (!this.clients.has(clientId)) throw new Error(`Cliente ${clientId} não encontrado`);

    const qrData = this.qrCodes.get(clientId);
    if (!qrData) throw new Error(`QR Code não disponível para cliente ${clientId}`);

    // Adicionar informações sobre expiração (QR codes do WhatsApp expiram em ~30 segundos)
    const now = new Date();
    const qrAge = now - qrData.timestamp;
    const isExpired = qrAge > 30000; // 30 segundos
    const timeUntilExpiration = Math.max(0, 30000 - qrAge);

    return {
      ...qrData,
      isExpired,
      ageInSeconds: Math.floor(qrAge / 1000),
      timeUntilExpirationMs: timeUntilExpiration,
      timeUntilExpirationSeconds: Math.floor(timeUntilExpiration / 1000)
    };
  }

  getStatus(clientId) {
    const status = this.clientStatus.get(clientId) || 'not_found';
    const result = { clientId, status, isReady: status === 'ready' };

    // Adicionar informações do QR code se disponível
    if (this.qrCodes.has(clientId)) {
      const qrData = this.qrCodes.get(clientId);
      const now = new Date();
      const qrAge = now - qrData.timestamp;
      const isExpired = qrAge > 30000;

      result.qrCode = {
        available: true,
        isExpired,
        ageInSeconds: Math.floor(qrAge / 1000),
        generatedAt: qrData.timestamp
      };
    } else {
      result.qrCode = { available: false };
    }

    return result;
  }

  async sendMessage(clientId, number, message) {
    const client = this.clients.get(clientId);
    if (!client) throw new Error(`Cliente ${clientId} não encontrado`);
    const chatId = number.includes('@') ? number : `${number}@c.us`;
    await client.sendMessage(chatId, message);
    return { success: true, to: chatId, message, timestamp: new Date() };
  }

  // Métodos para gerenciar mensagens recebidas (mantidos iguais)

  // Método para obter estatísticas de QR code
  getQRStats(clientId) {
    if (!this.clients.has(clientId)) {
      throw new Error(`Cliente ${clientId} não encontrado`);
    }

    const qrData = this.qrCodes.get(clientId);
    const generationTimestamp = this.qrGenerationTimestamps.get(clientId);
    const lastHash = this.lastQRHashes.get(clientId);

    return {
      clientId,
      hasQRCode: !!qrData,
      qrGeneratedAt: qrData?.timestamp || null,
      lastGenerationTimestamp: generationTimestamp || null,
      hasHash: !!lastHash,
      status: this.clientStatus.get(clientId) || 'unknown'
    };
  }
  getMessages(clientId, options = {}) {
    if (!this.clients.has(clientId)) {
      throw new Error(`Cliente ${clientId} não encontrado`);
    }

    const messages = this.receivedMessages.get(clientId) || [];
    let filteredMessages = [...messages];

    // Filtrar por remetente
    if (options.from) {
      filteredMessages = filteredMessages.filter(msg => 
        msg.from.includes(options.from) || 
        msg.contact.name.toLowerCase().includes(options.from.toLowerCase()) ||
        msg.contact.number.includes(options.from)
      );
    }

    // Filtrar por data (últimas X horas)
    if (options.lastHours) {
      const cutoffTime = new Date(Date.now() - (options.lastHours * 60 * 60 * 1000));
      filteredMessages = filteredMessages.filter(msg => msg.timestamp >= cutoffTime);
    }

    // Filtrar por tipo de mensagem
    if (options.type) {
      filteredMessages = filteredMessages.filter(msg => msg.type === options.type);
    }

    // Filtrar apenas grupos ou apenas contatos individuais
    if (options.onlyGroups === true) {
      filteredMessages = filteredMessages.filter(msg => msg.isGroup);
    } else if (options.onlyGroups === false) {
      filteredMessages = filteredMessages.filter(msg => !msg.isGroup);
    }

    // Ordenar por timestamp (mais recentes primeiro)
    filteredMessages.sort((a, b) => b.timestamp - a.timestamp);

    // Limitar quantidade
    const limit = options.limit || 50;
    filteredMessages = filteredMessages.slice(0, limit);

    return {
      clientId,
      total: messages.length,
      filtered: filteredMessages.length,
      messages: filteredMessages
    };
  }

  getMessageStats(clientId) {
    if (!this.clients.has(clientId)) {
      throw new Error(`Cliente ${clientId} não encontrado`);
    }

    const messages = this.receivedMessages.get(clientId) || [];
    const now = new Date();
    const last24h = messages.filter(msg => (now - msg.timestamp) <= 24 * 60 * 60 * 1000);
    const lastHour = messages.filter(msg => (now - msg.timestamp) <= 60 * 60 * 1000);

    const groupMessages = messages.filter(msg => msg.isGroup);
    const individualMessages = messages.filter(msg => !msg.isGroup);
    const mediaMessages = messages.filter(msg => msg.hasMedia);

    return {
      clientId,
      total: messages.length,
      last24Hours: last24h.length,
      lastHour: lastHour.length,
      groups: groupMessages.length,
      individual: individualMessages.length,
      withMedia: mediaMessages.length,
      oldestMessage: messages.length > 0 ? messages[0].timestamp : null,
      newestMessage: messages.length > 0 ? messages[messages.length - 1].timestamp : null
    };
  }

  clearMessages(clientId) {
    if (!this.clients.has(clientId)) {
      throw new Error(`Cliente ${clientId} não encontrado`);
    }

    const messageCount = this.receivedMessages.get(clientId)?.length || 0;
    this.receivedMessages.set(clientId, []);
    
    return {
      success: true,
      message: `${messageCount} mensagens removidas do cliente ${clientId}`
    };
  }

  async removeClient(clientId) {
    const client = this.clients.get(clientId);
    if (!client) throw new Error(`Cliente ${clientId} não encontrado`);

    await client.destroy();
    this.clients.delete(clientId);
    this.clientStatus.delete(clientId);
    this.qrCodes.delete(clientId);
    this.receivedMessages.delete(clientId); // Limpar mensagens do cliente removido

    // Limpar dados de controle de QR code
    this.lastQRHashes.delete(clientId);
    this.qrGenerationTimestamps.delete(clientId);

    return { success: true, message: `Cliente ${clientId} removido` };
  }

  listClients() {
    return Array.from(this.clients.keys()).map(id => ({
      clientId: id,
      status: this.clientStatus.get(id) || 'unknown',
      hasQR: this.qrCodes.has(id),
      messageCount: this.receivedMessages.get(id)?.length || 0
    }));
  }

  async destroyAllClients() {
    for (const [clientId, client] of this.clients) {
      try {
        await client.destroy();
        console.log(`Cliente ${clientId} encerrado`);
      } catch (error) {
        console.error(`Erro ao encerrar cliente ${clientId}:`, error);
      }
    }
    this.clients.clear();
    this.clientStatus.clear();
    this.qrCodes.clear();
    this.receivedMessages.clear();

    // Limpar dados de controle de QR code
    this.lastQRHashes.clear();
    this.qrGenerationTimestamps.clear();
  }
}

module.exports = new WhatsAppService();