const whatsappService = require('../services/whatsappService');

class WhatsAppController {
  async createClient(req, res) {
    try {
      const { clientId } = req.body;
      if (!clientId) return res.status(400).json({ error: 'clientId é obrigatório' });
      const result = await whatsappService.createClient(clientId);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async getQRCode(req, res) {
    try {
      const { clientId } = req.params;
      const qrData = whatsappService.getQRCode(clientId);
      res.json({
        clientId,
        qrCode: qrData.qrCodeDataURL,
        timestamp: qrData.timestamp
      });
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }

  async getStatus(req, res) {
    try {
      const { clientId } = req.params;
      const status = whatsappService.getStatus(clientId);
      res.json(status);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }

  async sendMessage(req, res) {
    try {
      const { clientId } = req.params;
      const { number, message } = req.body;
      if (!number || !message) {
        return res.status(400).json({ error: 'number e message são obrigatórios' });
      }
      const result = await whatsappService.sendMessage(clientId, number, message);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async removeClient(req, res) {
    try {
      const { clientId } = req.params;
      const result = await whatsappService.removeClient(clientId);
      res.json(result);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }

  async listClients(req, res) {
    try {
      const clients = whatsappService.listClients();
      res.json({ clients });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Novo endpoint para estatísticas do QR code
  async getQRStats(req, res) {
    try {
      const { clientId } = req.params;
      const stats = whatsappService.getQRStats(clientId);
      res.json(stats);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }

  // Novos endpoints para gerenciar mensagens recebidas
  async getMessages(req, res) {
    try {
      const { clientId } = req.params;
      const options = {};

      // Parâmetros de filtro opcionais
      if (req.query.from) options.from = req.query.from;
      if (req.query.lastHours) options.lastHours = parseInt(req.query.lastHours);
      if (req.query.type) options.type = req.query.type;
      if (req.query.limit) options.limit = parseInt(req.query.limit);
      if (req.query.onlyGroups !== undefined) {
        options.onlyGroups = req.query.onlyGroups === 'true';
      }

      const result = whatsappService.getMessages(clientId, options);
      res.json(result);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }

  async getMessageStats(req, res) {
    try {
      const { clientId } = req.params;
      const stats = whatsappService.getMessageStats(clientId);
      res.json(stats);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }

  async clearMessages(req, res) {
    try {
      const { clientId } = req.params;
      const result = whatsappService.clearMessages(clientId);
      res.json(result);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }

  async getLatestMessages(req, res) {
    try {
      const { clientId } = req.params;
      const limit = parseInt(req.query.limit) || 10;
      
      const result = whatsappService.getMessages(clientId, { 
        limit,
        lastHours: 24 // Últimas 24 horas por padrão
      });
      
      res.json({
        clientId,
        limit,
        messages: result.messages
      });
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }

  async searchMessages(req, res) {
    try {
      const { clientId } = req.params;
      const { query, type, onlyGroups } = req.query;
      
      if (!query) {
        return res.status(400).json({ error: 'Parâmetro query é obrigatório para busca' });
      }

      const options = {
        limit: parseInt(req.query.limit) || 50
      };

      if (type) options.type = type;
      if (onlyGroups !== undefined) options.onlyGroups = onlyGroups === 'true';

      const result = whatsappService.getMessages(clientId, options);
      
      // Filtrar mensagens que contenham o termo de busca
      const filteredMessages = result.messages.filter(msg => 
        msg.body.toLowerCase().includes(query.toLowerCase()) ||
        msg.fromName.toLowerCase().includes(query.toLowerCase())
      );

      res.json({
        clientId,
        query,
        total: filteredMessages.length,
        messages: filteredMessages
      });
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }
}

module.exports = new WhatsAppController();